require_relative 'subtask_loader'
require_relative 'ancestor_issue_updates'

module RedmineKanban
  class IssueUpdater
    include ParamNormalizer
    include PriorityPropagation
    include IssueWorkflow
    include ServiceResponse
    include AncestorIssueUpdates

    def initialize(project:, user:)
      @project = project
      @user = user
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
      attributes['start_date'] = normalize_date(params[:start_date]) if params.key?(:start_date)
      attributes['due_date'] = normalize_date(params[:due_date]) if params.key?(:due_date)
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

      Issue.transaction do
        issue.safe_attributes = attributes

        unless issue.save
          error_result = error_response(issue.errors.full_messages.join(', '), field_errors: issue.errors.to_hash(true))
          raise ActiveRecord::Rollback
        end

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

      ancestor_updates_required = issue.saved_change_to_status_id? || issue.saved_change_to_done_ratio?

      if priority_id.is_a?(Integer)
        reconcile_error = reconcile_priorities_after_commit!(issue, priority_id, priority_lock_versions)
        return error_response(reconcile_error) if reconcile_error
      end

      result = { ok: true, issue: issue_presenter(issue).issue_to_h(issue) }
      ancestor_updates = ancestor_updates_for(issue) if ancestor_updates_required
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

    def normalize_done_ratio(value)
      return nil if value.nil? || value.to_s.strip.empty?
      v = value.to_i
      v.clamp(0, 100)
    end

    def normalize_lock_version(value)
      normalize_optional_lock_version(value)
    end

    def issue_presenter(issue)
      BoardIssuePresenter.new(
        user: @user,
        board_project: @project,
        subtasks_by_parent_id: SubtaskLoader.new(user: @user).subtasks_by_parent_id([issue.id])
      )
    end

  end
end
