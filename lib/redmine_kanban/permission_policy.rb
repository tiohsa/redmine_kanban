module RedmineKanban
  class PermissionPolicy
    def initialize(user:)
      @user = user
    end

    def can_view_board?(project)
      allowed_to?(:view_redmine_kanban, project)
    end

    def can_move_issue?(issue_or_project, board_project = issue_or_project)
      issue_project = project_for(issue_or_project)
      allowed_to?(:manage_redmine_kanban, board_project) && allowed_to?(:edit_issues, issue_project) && tracker_editable?(issue_or_project)
    end

    def can_create_issue?(issue_project, board_project = issue_project)
      allowed_to?(:manage_redmine_kanban, board_project) && allowed_to?(:add_issues, issue_project)
    end

    def can_update_issue?(issue_or_project, board_project = issue_or_project)
      issue_project = project_for(issue_or_project)
      allowed_to?(:manage_redmine_kanban, board_project) && allowed_to?(:edit_issues, issue_project) && tracker_editable?(issue_or_project)
    end

    def can_delete_issue?(issue_or_project, board_project = issue_or_project)
      issue_project = project_for(issue_or_project)
      allowed_to?(:manage_redmine_kanban, board_project) && allowed_to?(:delete_issues, issue_project) && tracker_deletable?(issue_or_project)
    end

    def can_log_time?(project)
      allowed_to?(:log_time, project)
    end

    private

    def allowed_to?(permission, project)
      !!project && @user.allowed_to?(permission, project)
    end

    def project_for(issue_or_project)
      issue_or_project.respond_to?(:project) ? issue_or_project.project : issue_or_project
    end

    def tracker_editable?(issue_or_project)
      !issue_or_project.respond_to?(:editable?) || issue_or_project.editable?
    end

    def tracker_deletable?(issue_or_project)
      !issue_or_project.respond_to?(:deletable?) || issue_or_project.deletable?
    end
  end
end
