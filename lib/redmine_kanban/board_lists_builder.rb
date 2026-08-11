module RedmineKanban
  class BoardListsBuilder
    def initialize(project:, project_ids:, user:)
      @project = project
      @project_ids = project_ids
      @user = user
    end

    def build
      {
        assignees: assignees_list,
        trackers: trackers_list,
        priorities: priorities_list,
        projects: projects_list,
        viewable_projects: viewable_projects_list,
        creatable_projects: creatable_projects_list,
      }
    end

    private

    def projects_list
      project_catalog.subtree_projects(root: @project)
    end

    def viewable_projects_list
      project_catalog.viewable_projects
    end

    def creatable_projects_list
      project_catalog.creatable_projects
    end

    def assignees_list
      projects = Project.where(id: @project_ids).to_a
      users = projects.map(&:assignable_users).flatten.uniq.sort_by { |user| user.name.to_s.downcase }
      [{ id: nil, name: ::I18n.t("redmine_kanban.label_unassigned") }] + users.map { |user| { id: user.id, name: user.name } }
    end

    def trackers_list
      project_ids = @project_ids | project_catalog.subtree_projects(root: @project).map { |project| project[:id] }
      projects = Project.visible(@user).where(id: project_ids).includes(:trackers).to_a.select(&:active?)
      trackers = projects.flat_map(&:trackers).uniq.sort_by(&:position)
      available_project_ids_by_tracker = Hash.new { |hash, key| hash[key] = [] }
      projects.each do |project|
        project.trackers.each { |tracker| available_project_ids_by_tracker[tracker.id] << project.id }
      end

      TrackerMetadataBuilder.new(
        trackers: trackers,
        available_project_ids_by_tracker: available_project_ids_by_tracker,
      ).build
    end

    def priorities_list
      IssuePriority.active.sorted.to_a.map { |priority| { id: priority.id, name: priority.name } }
    end

    def project_catalog
      @project_catalog ||= ProjectCatalog.new(user: @user, board_project: @project)
    end
  end
end
