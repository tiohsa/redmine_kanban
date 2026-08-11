require_relative 'board_context'
require_relative 'ancestor_issue_updates'

module RedmineKanban
  class IssueMover
    include ParamNormalizer
    include PriorityPropagation
    include IssueWorkflow
    include ServiceResponse
    include AncestorIssueUpdates
    include MutationOutcome

    def initialize(project:, issue:, user:, board_context: nil, operation_id: nil)
      @project = project
      @issue = issue
      @user = user
      @board_context = board_context || BoardContext.new(project: project, user: user)
      @operation_id = operation_id
    end

    def move(status_id:, assigned_to_id: nil, priority_id: nil, assigned_to_provided: false, priority_provided: false, lock_version: nil)
      return error_response(I18n.t('redmine_kanban.error_permission_denied')) unless PermissionPolicy.new(user: @user).can_update_issue?(@issue, @project)

      status_id = status_id.to_i
      assigned_to_id = normalize_assigned_to_id(assigned_to_id, assigned_to_provided)
      priority_id = normalize_priority_id(priority_id, priority_provided)
      lock_version = normalize_lock_version(lock_version)

      return error_response(I18n.t('redmine_kanban.error_lock_version_required')) if lock_version.nil?

      if priority_id == :invalid
        return error_response(I18n.t('redmine_kanban.label_invalid_priority'))
      end

      unless status_allowed_for?(@issue, status_id)
        return error_response(
          I18n.t('redmine_kanban.error_workflow_transition'),
          code: 'WORKFLOW_TRANSITION_NOT_ALLOWED',
        )
      end

      @issue.init_journal(@user)
      attrs = { 'status_id' => status_id }
      if assigned_to_id != :no_change
        # 明示的にnilを設定して未割当にする（空文字列を使用）
        attrs['assigned_to_id'] = assigned_to_id.nil? ? '' : assigned_to_id
      end
      attrs['priority_id'] = priority_id unless priority_id == :no_change

      error_result = nil
      membership_resolver = BoardMembershipResolver.new(board_context: @board_context)
      before_primary_member = membership_resolver.primary_member?(@issue.id)
      preserve_parent_priority = priority_id == :no_change && @issue.parent_id.present?
      parent = nil
      parent_priority_before = nil
      priority_lock_versions = nil
      mutation_outcome = nil

      Issue.transaction do
        if preserve_parent_priority
          parent = @issue.parent
          parent.lock! if parent
          parent_priority_before = parent&.priority_id
        end

        @issue.safe_attributes = attrs
        @issue.lock_version = lock_version if lock_version

        unless @issue.save
          error_result = error_response(@issue.errors.full_messages.join(', '))
          raise ActiveRecord::Rollback
        end

        mutation_outcome = mutation_outcome_for(@issue)
        priority_error = apply_priority_updates!(@issue, priority_id)
        if priority_error
          error_result = error_response(priority_error)
          raise ActiveRecord::Rollback
        end
        priority_lock_versions = priority_lock_versions_for(@issue) if priority_id.is_a?(Integer)

        if preserve_parent_priority
          parent_error = restore_parent_priority!(parent, parent_priority_before)
          if parent_error
            error_result = error_response(parent_error)
            raise ActiveRecord::Rollback
          end
        end
      end

      return error_result if error_result

      after_primary_member = membership_resolver.primary_member?(@issue.id)

      ancestor_updates_required = mutation_outcome[:status_changed] || mutation_outcome[:done_ratio_changed]

      if priority_id.is_a?(Integer)
        reconcile_error = reconcile_priorities_after_commit!(@issue, priority_id, priority_lock_versions)
        return error_response(reconcile_error) if reconcile_error
      end

      ancestor_updates = ancestor_updates_for(@issue) if ancestor_updates_required
      ancestor_issues = ancestor_issues_for(@issue) if ancestor_updates_required
      propagated_issues = priority_id.is_a?(Integer) ? @issue.children.to_a : []
      issue_updates = [@issue, *(ancestor_issues || []), *propagated_issues].uniq { |item| item.id }
      membership_recheck_ids = if before_primary_member != after_primary_member
        membership_resolver.membership_candidate_ids([@issue.id])
      else
        []
      end
      result = mutation_result_builder.build(
        issue_updates: issue_updates,
        membership_recheck_ids: membership_recheck_ids,
        invalidations: { column_counts: true }
      ).merge(issue: issue_presenter(@issue).issue_to_h(@issue))
      result[:ancestor_updates] = ancestor_updates if ancestor_updates&.any?
      result
    rescue ActiveRecord::StaleObjectError
      error_response(I18n.t('redmine_kanban.error_conflict'), status: :conflict)
    end

    private

    def normalize_assigned_to_id(value, provided)
      return :no_change unless provided
      return nil if value.to_s == '' || value.to_s == 'null'

      value.to_i
    end

    def normalize_lock_version(value)
      normalize_optional_lock_version(value)
    end

    def normalize_priority_id(value, provided)
      return :no_change unless provided
      normalize_active_priority_id(value)
    end

    def restore_parent_priority!(parent, expected_priority_id)
      return nil unless parent
      parent.reload
      return nil if parent.priority_id == expected_priority_id

      parent.update_column(:priority_id, expected_priority_id)
      nil
    rescue StandardError => e
      I18n.t('redmine_kanban.error_parent_priority_preserve_failed', id: parent&.id || @issue.parent_id, detail: e.message)
    end

    def issue_presenter(issue)
      @board_context.presenter([issue.id]).first
    end

    def mutation_result_builder
      @mutation_result_builder ||= MutationResultBuilder.new(board_context: @board_context, operation_id: @operation_id)
    end

  end
end
