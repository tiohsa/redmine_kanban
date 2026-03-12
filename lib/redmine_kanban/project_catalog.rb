require 'set'

module RedmineKanban
  class ProjectCatalog
    def initialize(user:)
      @user = user
    end

    def subtree_projects(root:)
      build_project_list(
        root.self_and_descendants.visible.to_a.select(&:active?),
        base_depth: root.ancestors.count,
      )
    end

    def viewable_projects
      build_project_list(viewable_project_records)
    end

    def creatable_projects
      build_project_list(creatable_project_records)
    end

    def viewable_project_ids
      @viewable_project_ids ||= viewable_project_records.map(&:id).to_set
    end

    def creatable_project_ids
      @creatable_project_ids ||= creatable_project_records.map(&:id).to_set
    end

    private

    def visible_projects
      @visible_projects ||= Project.visible(@user).to_a.select(&:active?).sort_by(&:lft)
    end

    def viewable_project_records
      @viewable_project_records ||= visible_projects
    end

    def creatable_project_records
      @creatable_project_records ||= visible_projects.select { |project| can_create_issue?(project) }
    end

    def build_project_list(projects, base_depth: nil)
      projects.map do |project|
        {
          id: project.id,
          name: project.name,
          level: project.ancestors.count - (base_depth || 0),
        }
      end
    end

    def can_create_issue?(project)
      @user.allowed_to?(:add_issues, project)
    end
  end
end
