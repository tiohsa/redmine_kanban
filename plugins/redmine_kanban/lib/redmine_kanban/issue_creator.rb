module RedmineKanban
  class IssueCreator
    def initialize(project:, user:)
      @project = project
      @user = user
      @settings = Settings.new(Setting.plugin_redmine_kanban)
    end

    def create(params:)
      subject = params[:subject].to_s.strip
      return error(field_errors: { subject: ['件名を入力してください'] }) if subject.empty?

      issue = Issue.new
      issue.project = @project
      issue.author = @user
      issue.init_journal(@user)

      tracker_id = params[:tracker_id].to_s.strip
      tracker_id = default_tracker_id.to_s if tracker_id.empty?

      attributes = {
        'subject' => subject,
        'description' => params[:description].to_s,
        'status_id' => params[:status_id].to_i,
        'assigned_to_id' => normalize_assigned_to_id(params[:assigned_to_id]),
        'priority_id' => normalize_priority_id(params[:priority_id]),
        'due_date' => normalize_due_date(params[:due_date]),
        'tracker_id' => tracker_id.to_i
      }

      cf_values = blocked_custom_field_values(params)
      attributes['custom_field_values'] = cf_values if cf_values.any?

      issue.safe_attributes = attributes

      if issue.save
        { ok: true, issue: BoardData.new(project: @project, user: @user).send(:issue_to_h, issue) }
      else
        error(message: issue.errors.full_messages.join(', '), field_errors: issue.errors.to_hash(true))
      end
    end

    private

    def default_tracker_id
      @project.trackers.sorted.first&.id
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

    def normalize_due_date(value)
      v = value.to_s.strip
      return nil if v.empty?

      Date.parse(v)
    rescue ArgumentError
      nil
    end

    def blocked_custom_field_values(params)
      bool_id = @settings.blocked_bool_cf_id
      reason_id = @settings.blocked_reason_cf_id
      return {} if bool_id <= 0

      blocked = params[:blocked].to_s == '1'
      values = { bool_id.to_s => (blocked ? '1' : '0') }
      if reason_id > 0
        values[reason_id.to_s] = blocked ? params[:blocked_reason].to_s : ''
      end
      values
    end

    def error(message: nil, field_errors: {})
      { ok: false, message: message, field_errors: field_errors }
    end
  end
end
