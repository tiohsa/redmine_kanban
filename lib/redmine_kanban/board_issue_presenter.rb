module RedmineKanban
  class BoardIssuePresenter
    def initialize(user:)
      @user = user
    end

    def issue_to_h(issue)
      {
        id: issue.id,
        parent_id: issue.parent_id,
        subject: issue.subject,
        status_id: issue.status_id,
        can_log_time: @user.allowed_to?(:log_time, issue.project),
        lock_version: issue.lock_version,
        status_name: issue.status&.name,
        status_is_closed: issue.status&.is_closed,
        tracker_id: issue.tracker_id,
        description: issue.description,
        assigned_to_id: issue.assigned_to_id,
        assigned_to_name: issue.assigned_to&.name,
        start_date: issue.start_date&.to_s,
        due_date: issue.due_date&.to_s,
        priority_id: issue.priority_id,
        priority_name: issue.priority&.name,
        done_ratio: issue.done_ratio,
        updated_on: issue.updated_on&.iso8601,
        aging_days: aging_days(issue),
        project: { id: issue.project_id, name: issue.project.name },
        subtasks: subtask_tree(issue),
        urls: {
          issue: Rails.application.routes.url_helpers.issue_path(issue),
          issue_edit: Rails.application.routes.url_helpers.edit_issue_path(issue),
        },
      }
    end

    private

    def aging_days(issue)
      return 0 unless issue.updated_on

      (Date.current - issue.updated_on.to_date).to_i
    end

    def subtask_tree(issue)
      issue.children.visible.map { |child| subtask_to_h(child) }
    end

    def subtask_to_h(issue)
      {
        id: issue.id,
        subject: issue.subject,
        status_id: issue.status_id,
        is_closed: issue.status.is_closed?,
        lock_version: issue.lock_version,
        subtasks: subtask_tree(issue),
      }
    end
  end
end
