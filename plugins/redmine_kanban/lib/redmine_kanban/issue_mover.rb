module RedmineKanban
  class IssueMover
    def initialize(project:, issue:, user:)
      @project = project
      @issue = issue
      @user = user
      @settings = Settings.new(Setting.plugin_redmine_kanban)
    end

    def move(status_id:, assigned_to_id:)
      return error('権限がありません') unless @issue.editable?

      status_id = status_id.to_i
      assigned_to_id = normalize_assigned_to_id(assigned_to_id)

      unless status_allowed?(status_id)
        return error('ワークフロー上、このステータスへ遷移できません')
      end

      wip_check = WipChecker.new(project: @project, settings: @settings, user: @user).check_move(
        issue: @issue,
        target_status_id: status_id,
        target_assigned_to_id: assigned_to_id
      )
      if wip_check[:blocked]
        return error(wip_check[:message])
      end
      warning = wip_check[:message]

      @issue.init_journal(@user)
      attrs = { 'status_id' => status_id }
      if should_update_assignee?
        # 明示的にnilを設定して未割当にする（空文字列を使用）
        attrs['assigned_to_id'] = assigned_to_id.nil? ? '' : assigned_to_id
      end
      @issue.safe_attributes = attrs

      if @issue.save
        result = { ok: true, issue: BoardData.new(project: @project, user: @user).send(:issue_to_h, @issue) }
        result[:warning] = warning if warning.present?
        result
      else
        error(@issue.errors.full_messages.join(', '))
      end
    end

    private

    def normalize_assigned_to_id(value)
      return nil if value.nil? || value.to_s == '' || value.to_s == 'null'

      value.to_i
    end

    def should_update_assignee?
      @settings.lane_type == 'assignee'
    end

    def status_allowed?(status_id)
      return true if status_id == @issue.status_id

      @issue.new_statuses_allowed_to(@user).map(&:id).include?(status_id)
    end

    def error(message)
      { ok: false, message: message }
    end
  end
end
