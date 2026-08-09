require_relative 'board_context'
require_relative 'ancestor_issue_updates'

module RedmineKanban
  class IssueUpdater
    include ParamNormalizer
    include PriorityPropagation
    include IssueWorkflow
    include ServiceResponse
    include AncestorIssueUpdates
    include MutationOutcome

    def initialize(project:, user:, board_context: nil, operation_id: nil)
      @project = project
      @user = user
      @board_context = board_context || BoardContext.new(project: project, user: user)
      @operation_id = operation_id
    end

    def update(issue_id:, params:)
      issue = Issue.visible(@user).find_by(id: issue_id)
      return error_response('タスクが見つかりません', status: :not_found) unless issue
      return error_response('権限がありません', status: :forbidden) unless PermissionPolicy.new(user: @user).can_update_issue?(issue, @project)

      issue.init_journal(@user)

      attributes = {}
      priority_id = :no_change
      attributes['subject'] = params[:subject].to_s.strip if params.key?(:subject)
      attributes['description'] = params[:description].to_s if params.key?(:description)
      attributes['assigned_to_id'] = normalize_assigned_to_id(params[:assigned_to_id]) if params.key?(:assigned_to_id)
      if params.key?(:priority_id)
        priority_id = normalize_priority_id(params[:priority_id])
        return error_response('優先度の値が不正です') if priority_id == :invalid

        attributes['priority_id'] = priority_id
      end
      if params.key?(:start_date)
        start_date = normalize_date(params[:start_date])
        return invalid_date_response(:start_date) if start_date == :invalid

        attributes['start_date'] = start_date
      end
      if params.key?(:due_date)
        due_date = normalize_date(params[:due_date])
        return invalid_date_response(:due_date) if due_date == :invalid

        attributes['due_date'] = due_date
      end
      attributes['tracker_id'] = normalize_tracker_id(params[:tracker_id]) if params.key?(:tracker_id)
      attributes['done_ratio'] = normalize_done_ratio(params[:done_ratio]) if params.key?(:done_ratio)

      lock_version = normalize_lock_version(params[:lock_version])
      return error_response('lock_versionが必要です') if lock_version.nil?

      issue.lock_version = lock_version

      # Handle status change if provided
      if params[:status_id].present? && params[:status_id].to_i != issue.status_id
        status_id = params[:status_id].to_i
        if status_allowed_for?(issue, status_id)
          attributes['status_id'] = status_id
        else
          return error_response('ワークフロー上、このステータスへ遷移できません')
        end
      end

      error_result = nil
      priority_updated = priority_id != :no_change
      priority_lock_versions = nil
      mutation_outcome = nil

      Issue.transaction do
        issue.safe_attributes = attributes

        unless issue.save
          error_result = error_response(issue.errors.full_messages.join(', '), field_errors: issue.errors.to_hash(true))
          raise ActiveRecord::Rollback
        end

        mutation_outcome = mutation_outcome_for(issue)
        if priority_updated
          priority_error = apply_priority_updates!(issue, priority_id)
          if priority_error
            error_result = error_response(priority_error)
            raise ActiveRecord::Rollback
          end
          priority_lock_versions = priority_lock_versions_for(issue)
        end
      end

      return error_result if error_result

      ancestor_updates_required = mutation_outcome[:status_changed] || mutation_outcome[:done_ratio_changed]

      if priority_id.is_a?(Integer)
        reconcile_error = reconcile_priorities_after_commit!(issue, priority_id, priority_lock_versions)
        return error_response(reconcile_error) if reconcile_error
      end

      ancestor_updates = ancestor_updates_for(issue) if ancestor_updates_required
      ancestor_issues = ancestor_issues_for(issue) if ancestor_updates_required
      propagated_issues = priority_id.is_a?(Integer) ? issue.children.to_a : []
      issue_updates = [issue, *(ancestor_issues || []), *propagated_issues].uniq { |item| item.id }
      membership_recheck_ids = if mutation_outcome[:status_changed] || mutation_outcome[:assigned_to_changed]
        BoardMembershipResolver.new(board_context: @board_context).membership_candidate_ids([issue.id])
      else
        []
      end
      result = mutation_result_builder.build(
        issue_updates: issue_updates,
        membership_recheck_ids: membership_recheck_ids,
        invalidations: { column_counts: true }
      ).merge(issue: issue_presenter(issue).issue_to_h(issue))
      result[:ancestor_updates] = ancestor_updates if ancestor_updates&.any?
      result
    rescue ActiveRecord::StaleObjectError
      error_response('他ユーザにより更新されました', status: :conflict)
    end

    private

    def normalize_tracker_id(value)
      normalize_optional_integer(value)
    end

    def normalize_assigned_to_id(value)
      normalize_nullable_id(value)
    end

    def normalize_priority_id(value)
      normalize_active_priority_id(value)
    end

    def normalize_date(value)
      normalize_optional_date(value)
    end

    def invalid_date_response(field)
      label = field == :start_date ? '開始日' : '期日'
      error_response("#{label}の日付が不正です", field_errors: { field => ["#{label}の日付が不正です"] })
    end

    def normalize_done_ratio(value)
      return nil if value.nil? || value.to_s.strip.empty?
      v = value.to_i
      v.clamp(0, 100)
    end

    def normalize_lock_version(value)
      normalize_optional_lock_version(value)
    end

    def issue_presenter(issue)
      @board_context.presenter([issue.id]).first
    end

    def mutation_result_builder
      @mutation_result_builder ||= MutationResultBuilder.new(board_context: @board_context, operation_id: @operation_id)
    end

  end
end
