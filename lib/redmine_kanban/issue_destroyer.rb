require_relative 'board_context'
require_relative 'board_membership_resolver'
require_relative 'mutation_result_builder'
require_relative 'permission_policy'

module RedmineKanban
  class IssueDestroyer
    def initialize(project:, issue:, user:, board_context: nil, operation_id: nil)
      @project = project
      @issue = issue
      @user = user
      @board_context = board_context || BoardContext.new(project: project, user: user)
      @operation_id = operation_id
    end

    def destroy(lock_version:)
      return failure(I18n.t('redmine_kanban.error_lock_version_required')) if lock_version.blank?

      result = nil
      membership_resolver = BoardMembershipResolver.new(board_context: @board_context)
      deletion_candidate_ids = []
      deletion_delta_overflow = false
      deleted_parent_id = @issue.parent_id
      affected_ancestor_ids = @issue.ancestors.select { |ancestor| ancestor.visible?(@user) }.map(&:id)

      Issue.transaction do
        locked_issue = Issue.lock.find_by(id: @issue.id)
        unless locked_issue && locked_issue.lock_version.to_i == lock_version.to_i
          result = failure(I18n.t('redmine_kanban.error_conflict'))
          raise ActiveRecord::Rollback
        end

        unless PermissionPolicy.new(user: @user).can_delete_issue?(locked_issue, @project)
          result = failure(I18n.t('redmine_kanban.error_permission_denied'))
          raise ActiveRecord::Rollback
        end

        candidate_result = membership_resolver.deletion_candidate_ids(
          [locked_issue.id],
          limit: @board_context.effective_entity_limit
        )
        deletion_delta_overflow = candidate_result[:overflow]
        unless deletion_delta_overflow
          deletion_candidate_ids = Issue.lock
                                        .where(id: candidate_result[:ids])
                                        .order(id: :asc)
                                        .pluck(:id)
        end

        result = locked_issue.destroy ? { ok: true } : failure(I18n.t('redmine_kanban.error_delete_failed'))
        raise ActiveRecord::Rollback unless result[:ok]

        unless deletion_delta_overflow
          surviving_ids = Issue.where(id: deletion_candidate_ids).pluck(:id)
          deletion_candidate_ids -= surviving_ids
        end
      end

      return result unless result[:ok]

      affected_ancestors = Issue.visible(@user).where(id: affected_ancestor_ids).to_a
      mutation_result_builder.build(
        deleted_issue_ids: deletion_delta_overflow ? [] : deletion_candidate_ids,
        issue_updates: affected_ancestors,
        invalidations: {
          issue_ids: affected_ancestor_ids,
          parent_ids: [deleted_parent_id].compact,
          column_counts: true,
          board_snapshot: deletion_delta_overflow
        }
      )
    rescue ActiveRecord::StaleObjectError
      failure(I18n.t('redmine_kanban.error_conflict'))
    end

    private

    def failure(message)
      { ok: false, message: message }
    end

    def mutation_result_builder
      @mutation_result_builder ||= MutationResultBuilder.new(
        board_context: @board_context,
        operation_id: @operation_id
      )
    end
  end
end
