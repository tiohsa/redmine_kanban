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
      target_project_id = params[:project_id].to_i
      target_project = if target_project_id > 0
                         Project.visible(@user).find_by(id: target_project_id)
                       else
                         @project
                       end
      issue.project = target_project || @project
      issue.author = @user
      issue.init_journal(@user)

      tracker_id = params[:tracker_id].to_s.strip
      tracker_id = default_tracker_id(issue.project).to_s if tracker_id.empty?

      attributes = {
        'subject' => subject,
        'description' => params[:description].to_s,
        'status_id' => params[:status_id].to_i,
        'assigned_to_id' => normalize_assigned_to_id(params[:assigned_to_id]),
        'priority_id' => normalize_priority_id(params[:priority_id]),
        'start_date' => normalize_date(params[:start_date]),
        'due_date' => normalize_date(params[:due_date]),
        'tracker_id' => tracker_id.to_i
      }

      if params[:parent_issue_id].present?
        attributes['parent_issue_id'] = params[:parent_issue_id]
      end

      issue.safe_attributes = attributes

      if issue.save
        { ok: true, issue: BoardData.new(project: @project, user: @user).send(:issue_to_h, issue) }
      else
        error(message: issue.errors.full_messages.join(', '), field_errors: issue.errors.to_hash(true))
      end
    end

    private

    def default_tracker_id(project)
      project.trackers.sorted.first&.id
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

    def error(message: nil, field_errors: {})
      { ok: false, message: message, field_errors: field_errors }
    end
  end
end
