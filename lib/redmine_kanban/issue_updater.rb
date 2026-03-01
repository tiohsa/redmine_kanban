module RedmineKanban
  class IssueUpdater
    include ParamNormalizer

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
      priority_id = :no_change
      attributes['subject'] = params[:subject].to_s.strip if params.key?(:subject)
      attributes['description'] = params[:description].to_s if params.key?(:description)
      attributes['assigned_to_id'] = normalize_assigned_to_id(params[:assigned_to_id]) if params.key?(:assigned_to_id)
      if params.key?(:priority_id)
        priority_id = normalize_priority_id(params[:priority_id])
        return error('優先度の値が不正です') if priority_id == :invalid

        attributes['priority_id'] = priority_id
      end
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

      error_result = nil
      priority_updated = priority_id != :no_change

      Issue.transaction do
        issue.safe_attributes = attributes

        unless issue.save
          error_result = error(issue.errors.full_messages.join(', '), field_errors: issue.errors.to_hash(true))
          raise ActiveRecord::Rollback
        end

        if priority_updated
          priority_error = apply_priority_updates!(issue, priority_id)
          if priority_error
            error_result = error(priority_error)
            raise ActiveRecord::Rollback
          end
        end
      end

      return error_result if error_result

      if priority_id.is_a?(Integer)
        reconcile_error = reconcile_priorities_after_commit!(issue, priority_id)
        return error(reconcile_error) if reconcile_error
      end

      result = { ok: true, issue: BoardData.new(project: @project, user: @user).send(:issue_to_h, issue) }
      result[:warning] = @warning if @warning.present?
      result
    rescue ActiveRecord::StaleObjectError
      error('他ユーザにより更新されました', status: :conflict)
    end

    private

    def normalize_tracker_id(value)
      normalize_optional_integer(value)
    end

    def normalize_assigned_to_id(value)
      normalize_nullable_id(value)
    end

    def normalize_priority_id(value)
      v = value.to_s.strip
      return nil if v == '' || v == 'null'
      return :invalid unless v.match?(/\A\d+\z/)

      parsed = v.to_i
      return :invalid unless parsed.positive?
      return :invalid unless IssuePriority.active.exists?(id: parsed)

      parsed
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

    def status_allowed?(issue, status_id)
      return true if status_id == issue.status_id
      issue.new_statuses_allowed_to(@user).map(&:id).include?(status_id)
    end

    def apply_priority_updates!(issue, priority_id)
      ensure_priority_applied!(issue, priority_id) ||
        update_children_priority!(issue, priority_id) ||
        ensure_priority_applied!(issue, priority_id)
    end

    def update_children_priority!(issue, priority_id)
      value = priority_id

      issue.children.each do |child|
        return "子チケット ##{child.id} を更新できません" unless child.editable?

        child.init_journal(@user)
        child.safe_attributes = { 'priority_id' => value }
        unless child.save
          return child.errors.full_messages.join(', ')
        end

        child_priority_error = ensure_priority_applied!(child, priority_id)
        return child_priority_error if child_priority_error
      end

      nil
    end

    def ensure_priority_applied!(issue, priority_id)
      return nil unless priority_id.is_a?(Integer)
      return nil if issue.priority_id == priority_id

      issue.update_column(:priority_id, priority_id)
      issue.priority_id = priority_id
      nil
    rescue StandardError => e
      "チケット ##{issue.id} の優先度を反映できません: #{e.message}"
    end

    def reconcile_priorities_after_commit!(issue, priority_id)
      issue.reload
      issue_error = ensure_priority_applied!(issue, priority_id)
      return issue_error if issue_error

      issue.children.each do |child|
        child.reload
        child_error = ensure_priority_applied!(child, priority_id)
        return child_error if child_error
      end

      nil
    end

    def error(message, status: :unprocessable_entity, field_errors: {})
      { ok: false, message: message, field_errors: field_errors, http_status: status }
    end
  end
end
