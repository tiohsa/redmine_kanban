module RedmineKanban
  class PermissionPolicy
    def initialize(user:)
      @user = user
    end

    def can_view_board?(project)
      allowed_to?(:view_redmine_kanban, project)
    end

    def can_move_issue?(project)
      allowed_to?(:manage_redmine_kanban, project) && allowed_to?(:edit_issues, project)
    end

    def can_create_issue?(project)
      allowed_to?(:manage_redmine_kanban, project) && allowed_to?(:add_issues, project)
    end

    def can_update_issue?(project)
      allowed_to?(:view_redmine_kanban, project) && allowed_to?(:edit_issues, project)
    end

    def can_delete_issue?(project)
      allowed_to?(:view_redmine_kanban, project) && allowed_to?(:delete_issues, project)
    end

    def can_log_time?(project)
      allowed_to?(:log_time, project)
    end

    private

    def allowed_to?(permission, project)
      !!project && @user.allowed_to?(permission, project)
    end
  end
end
