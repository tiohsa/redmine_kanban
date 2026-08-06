module RedmineKanban
  class PermissionPolicy
    def initialize(user:)
      @user = user
      @allowed_cache = {}
      @editable_cache = {}
      @deletable_cache = {}
    end

    def can_view_board?(project)
      allowed_to?(:view_redmine_kanban, project)
    end

    def can_move_issue?(issue_or_project, board_project = issue_or_project)
      issue_project = project_for(issue_or_project)
      can_manage_board?(board_project) && allowed_to?(:edit_issues, issue_project) && tracker_editable?(issue_or_project)
    end

    def can_create_issue?(issue_project, board_project = issue_project)
      can_manage_board?(board_project) && allowed_to?(:add_issues, issue_project)
    end

    def can_update_issue?(issue_or_project, board_project = issue_or_project)
      issue_project = project_for(issue_or_project)
      can_manage_board?(board_project) && allowed_to?(:edit_issues, issue_project) && tracker_editable?(issue_or_project)
    end

    def can_delete_issue?(issue_or_project, board_project = issue_or_project)
      issue_project = project_for(issue_or_project)
      can_manage_board?(board_project) && allowed_to?(:delete_issues, issue_project) && tracker_deletable?(issue_or_project)
    end

    def can_log_time?(project)
      allowed_to?(:log_time, project)
    end

    private

    def can_manage_board?(project)
      can_view_board?(project) && allowed_to?(:manage_redmine_kanban, project)
    end

    def allowed_to?(permission, project)
      return false unless project
      return @user.allowed_to?(permission, project) unless project.respond_to?(:id)

      key = [permission, project.id]
      @allowed_cache.fetch(key) { @allowed_cache[key] = @user.allowed_to?(permission, project) }
    end

    def project_for(issue_or_project)
      issue_or_project.respond_to?(:project) ? issue_or_project.project : issue_or_project
    end

    def tracker_editable?(issue_or_project)
      return true unless issue_or_project.respond_to?(:editable?)
      return issue_or_project.editable? unless issue_or_project.respond_to?(:project_id) && issue_or_project.respond_to?(:tracker_id)

      key = [issue_or_project.project_id, issue_or_project.tracker_id, issue_or_project.author_id]
      @editable_cache.fetch(key) { @editable_cache[key] = issue_or_project.editable? }
    end

    def tracker_deletable?(issue_or_project)
      return true unless issue_or_project.respond_to?(:deletable?)
      return issue_or_project.deletable? unless issue_or_project.respond_to?(:project_id) && issue_or_project.respond_to?(:tracker_id)

      key = [issue_or_project.project_id, issue_or_project.tracker_id]
      @deletable_cache.fetch(key) { @deletable_cache[key] = issue_or_project.deletable? }
    end
  end
end
