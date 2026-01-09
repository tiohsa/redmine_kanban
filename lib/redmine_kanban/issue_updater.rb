module RedmineKanban
  class IssueUpdater
    def initialize(project:, user:)
      @project = project
      @user = user
      @settings = Settings.new(Setting.plugin_redmine_kanban)
    end

    def update(issue_id:, params:)
      issue = Issue.visible(@user).find_by(id: issue_id)
      return error('タスクが見つかりません', status: :not_found) unless issue
      return error('権限がありません', status: :forbidden) unless issue.editable?

      issue.init_journal(@user)

      attributes = {}
      attributes['subject'] = params[:subject].to_s.strip if params.key?(:subject)
      attributes['description'] = params[:description].to_s if params.key?(:description)
      attributes['assigned_to_id'] = normalize_assigned_to_id(params[:assigned_to_id]) if params.key?(:assigned_to_id)
      attributes['priority_id'] = normalize_priority_id(params[:priority_id]) if params.key?(:priority_id)
      attributes['start_date'] = normalize_date(params[:start_date]) if params.key?(:start_date)
      attributes['due_date'] = normalize_date(params[:due_date]) if params.key?(:due_date)
      attributes['tracker_id'] = normalize_tracker_id(params[:tracker_id]) if params.key?(:tracker_id)
      attributes['done_ratio'] = normalize_done_ratio(params[:done_ratio]) if params.key?(:done_ratio)

      lock_version = normalize_lock_version(params[:lock_version])
      issue.lock_version = lock_version if lock_version

      # Handle status change if provided
      if params[:status_id].present? && params[:status_id].to_i != issue.status_id
        status_id = params[:status_id].to_i
        if status_allowed?(issue, status_id)
           # WIP check for status change
           wip_check = WipChecker.new(project: @project, settings: @settings, user: @user).check_move(
            issue: issue,
            target_status_id: status_id,
            target_assigned_to_id: attributes['assigned_to_id'] || issue.assigned_to_id
          )
          if wip_check[:blocked]
             return error(wip_check[:message])
          end
          attributes['status_id'] = status_id
          @warning = wip_check[:message]
        else
          return error('ワークフロー上、このステータスへ遷移できません')
        end
      end

      # Remove empty/nil values to avoid overwriting with defaults if not intended (though here we intend to update)
      # Actually safe_attributes handles this, but for some normalization we did above.

      issue.safe_attributes = attributes

      if issue.save
        result = { ok: true, issue: BoardData.new(project: @project, user: @user).send(:issue_to_h, issue) }
        result[:warning] = @warning if @warning.present?
        result
      else
        error(issue.errors.full_messages.join(', '), field_errors: issue.errors.to_hash(true))
      end
    rescue ActiveRecord::StaleObjectError
      error('他ユーザにより更新されました', status: :conflict)
    end

    private

    def normalize_tracker_id(value)
      v = value.to_s.strip
      return nil if v.empty?
      v.to_i
    end

    def normalize_assigned_to_id(value)
      return nil if value.nil? || value.to_s == '' || value.to_s == 'null'
      value.to_i
    end

    def normalize_priority_id(value)
      v = value.to_s.strip
      return nil if v.empty?
      v.to_i
    end

    def normalize_date(value)
      v = value.to_s.strip
      return nil if v.empty?
      Date.parse(v)
    rescue ArgumentError
      nil
    end

    def normalize_done_ratio(value)
      return nil if value.nil? || value.to_s.strip.empty?
      v = value.to_i
      v.clamp(0, 100)
    end

    def normalize_lock_version(value)
      return nil if value.nil? || value.to_s.strip.empty?

      value.to_i
    end

    def status_allowed?(issue, status_id)
      return true if status_id == issue.status_id
      issue.new_statuses_allowed_to(@user).map(&:id).include?(status_id)
    end

    def error(message, status: :unprocessable_entity, field_errors: {})
      { ok: false, message: message, field_errors: field_errors, http_status: status }
    end
  end
end
