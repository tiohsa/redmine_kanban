module RedmineKanban
  class IssueCreator
    include ParamNormalizer
    include IssueParentAttributes
    include ServiceResponse

    def initialize(project:, user:)
      @project = project
      @user = user
      @settings = Settings.new(Setting.plugin_redmine_kanban)
    end

    def create(params:)
      subject = params[:subject].to_s.strip
      return error_response(nil, field_errors: { subject: ['件名を入力してください'] }) if subject.empty?

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
      parent_issue = find_visible_parent_issue(params[:parent_issue_id])

      tracker_id = params[:tracker_id].to_s.strip
      if tracker_id.empty?
        tracker_id = if !param_key_provided?(params, 'tracker_id') && parent_issue&.tracker_id.present?
                       parent_issue.tracker_id.to_s
                     else
                       default_tracker_id(issue.project).to_s
                     end
      end

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
        apply_parent_defaults!(attributes, params, parent_issue)
      end

      issue.safe_attributes = attributes

      if issue.save
        { ok: true, issue: BoardIssuePresenter.new(user: @user).issue_to_h(issue) }
      else
        error_response(issue.errors.full_messages.join(', '), field_errors: issue.errors.to_hash(true))
      end
    end

    private

    def default_tracker_id(project)
      project.trackers.sorted.first&.id
    end

    def find_visible_parent_issue(parent_issue_id)
      return nil if parent_issue_id.blank?

      Issue.visible(@user).find_by(id: parent_issue_id)
    end

    def param_key_provided?(params, key)
      return false unless params.respond_to?(:key?)

      params.key?(key) || params.key?(key.to_s) || params.key?(key.to_sym)
    end

    def normalize_assigned_to_id(value)
      normalize_nullable_id(value)
    end

    def normalize_priority_id(value)
      normalize_optional_integer(value)
    end

    def normalize_date(value)
      normalize_optional_date(value)
    end

  end
end
