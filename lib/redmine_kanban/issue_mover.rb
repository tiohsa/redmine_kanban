module RedmineKanban
  class IssueMover
    def initialize(project:, issue:, user:)
      @project = project
      @issue = issue
      @user = user
      @settings = Settings.new(Setting.plugin_redmine_kanban)
    end

    def move(status_id:, assigned_to_id:, priority_id: nil, lock_version: nil)
      return error('権限がありません') unless @issue.editable?

      status_id = status_id.to_i
      assigned_to_id = normalize_assigned_to_id(assigned_to_id)
      priority_id = normalize_priority_id(priority_id)
      lock_version = normalize_lock_version(lock_version)

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
      attrs['priority_id'] = priority_id.nil? ? '' : priority_id unless priority_id == :no_change

      # Apply auto-update rules for the target status
      auto_attrs = @settings.status_auto_updates[status_id] || {}
      auto_attrs.each do |key, value|
        # Skip if already set by explicit user action (e.g., assigned_to_id from lane)
        next if attrs.key?(key)

        if key == 'closed_on'
          final_value = value == '__today__' ? Time.current : value
          @issue.closed_on = final_value
        else
          final_value = value == '__today__' ? Date.current : value
          attrs[key] = final_value
        end
      end

      error_result = nil

      Issue.transaction do
        @issue.safe_attributes = attrs
        @issue.lock_version = lock_version if lock_version

        unless @issue.save
          error_result = error(@issue.errors.full_messages.join(', '))
          raise ActiveRecord::Rollback
        end

        if priority_id != :no_change
          child_error = update_children_priority!(priority_id)
          if child_error
            error_result = error(child_error)
            raise ActiveRecord::Rollback
          end
        end
      end

      return error_result if error_result

      result = { ok: true, issue: BoardData.new(project: @issue.project, user: @user).send(:issue_to_h, @issue) }
      result[:warning] = warning if warning.present?
      result
    rescue ActiveRecord::StaleObjectError
      error('他ユーザにより更新されました', status: :conflict)
    end

    private

    def normalize_assigned_to_id(value)
      return nil if value.nil? || value.to_s == '' || value.to_s == 'null'

      value.to_i
    end

    def normalize_lock_version(value)
      return nil if value.nil? || value.to_s.strip == ''

      value.to_i
    end

    def normalize_priority_id(value)
      return :no_change if value.nil?
      return nil if value.to_s.strip == '' || value.to_s == 'null'

      value.to_i
    end

    def should_update_assignee?
      @settings.lane_type == 'assignee'
    end

    def update_children_priority!(priority_id)
      value = priority_id.nil? ? '' : priority_id

      @issue.children.each do |child|
        return "子チケット ##{child.id} を更新できません" unless child.editable?

        child.init_journal(@user)
        child.safe_attributes = { 'priority_id' => value }
        next if child.save

        return child.errors.full_messages.join(', ')
      end

      nil
    end

    def status_allowed?(status_id)
      return true if status_id == @issue.status_id

      @issue.new_statuses_allowed_to(@user).map(&:id).include?(status_id)
    end

    def error(message, status: :unprocessable_entity)
      { ok: false, message: message, http_status: status }
    end
  end
end
