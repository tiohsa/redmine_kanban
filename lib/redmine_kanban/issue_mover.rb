module RedmineKanban
  class IssueMover
    include ParamNormalizer
    include PriorityPropagation
    include IssueWorkflow
    include ServiceResponse

    def initialize(project:, issue:, user:)
      @project = project
      @issue = issue
      @user = user
      @settings = Settings.new(Setting.plugin_redmine_kanban)
    end

    def move(status_id:, assigned_to_id: nil, priority_id: nil, assigned_to_provided: false, priority_provided: false, lock_version: nil)
      return error_response('権限がありません') unless @issue.editable?

      status_id = status_id.to_i
      assigned_to_id = normalize_assigned_to_id(assigned_to_id, assigned_to_provided)
      priority_id = normalize_priority_id(priority_id, priority_provided)
      lock_version = normalize_lock_version(lock_version)

      if priority_id == :invalid
        return error_response('優先度の値が不正です')
      end

      unless status_allowed_for?(@issue, status_id)
        return error_response('ワークフロー上、このステータスへ遷移できません')
      end

      wip_check = check_wip!(
        issue: @issue,
        status_id: status_id,
        assigned_to_id: assigned_to_id == :no_change ? @issue.assigned_to_id : assigned_to_id,
      )
      if wip_check[:blocked]
        return error_response(wip_check[:message])
      end
      warning = wip_check[:message]

      @issue.init_journal(@user)
      attrs = { 'status_id' => status_id }
      if should_update_assignee? && assigned_to_id != :no_change
        # 明示的にnilを設定して未割当にする（空文字列を使用）
        attrs['assigned_to_id'] = assigned_to_id.nil? ? '' : assigned_to_id
      end
      attrs['priority_id'] = priority_id unless priority_id == :no_change

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
      preserve_parent_priority = priority_id == :no_change && @issue.parent_id.present?
      parent_priority_before = @issue.parent&.priority_id if preserve_parent_priority

      Issue.transaction do
        @issue.safe_attributes = attrs
        @issue.lock_version = lock_version if lock_version

        unless @issue.save
          error_result = error_response(@issue.errors.full_messages.join(', '))
          raise ActiveRecord::Rollback
        end

        priority_error = apply_priority_updates!(@issue, priority_id)
        if priority_error
          error_result = error_response(priority_error)
          raise ActiveRecord::Rollback
        end

        if preserve_parent_priority
          parent_error = restore_parent_priority!(parent_priority_before)
          if parent_error
            error_result = error_response(parent_error)
            raise ActiveRecord::Rollback
          end
        end
      end

      return error_result if error_result

      if priority_id.is_a?(Integer)
        reconcile_error = reconcile_priorities_after_commit!(@issue, priority_id)
        return error_response(reconcile_error) if reconcile_error
      end

      result = { ok: true, issue: BoardIssuePresenter.new(user: @user).issue_to_h(@issue) }
      result[:warning] = warning if warning.present?
      result
    rescue ActiveRecord::StaleObjectError
      error_response('他ユーザにより更新されました', status: :conflict)
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

    def restore_parent_priority!(expected_priority_id)
      parent = @issue.parent
      return nil unless parent
      return nil if parent.priority_id == expected_priority_id

      parent.update_column(:priority_id, expected_priority_id)
      nil
    rescue StandardError => e
      "親チケット ##{parent&.id || @issue.parent_id} の優先度を維持できません: #{e.message}"
    end

    def should_update_assignee?
      @settings.lane_type == 'assignee'
    end

  end
end
