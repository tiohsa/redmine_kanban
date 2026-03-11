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
      }
    end

    private

    def projects_list
      base_depth = @project.ancestors.count
      @project.self_and_descendants.visible.to_a.map do |project|
        { id: project.id, name: project.name, level: project.ancestors.count - base_depth }
      end
    end

    def assignees_list
      projects = Project.where(id: @project_ids).to_a
      users = projects.map(&:assignable_users).flatten.uniq.sort_by { |user| user.name.to_s.downcase }
      [{ id: nil, name: ::I18n.t(:label_kanban_unassigned) }] + users.map { |user| { id: user.id, name: user.name } }
    end

    def trackers_list
      trackers = Project.where(id: @project_ids).includes(:trackers).flat_map(&:trackers).uniq.sort_by(&:position)
      trackers.map { |tracker| { id: tracker.id, name: tracker.name } }
    end

    def priorities_list
      IssuePriority.active.sorted.to_a.map { |priority| { id: priority.id, name: priority.name } }
    end
  end
end
