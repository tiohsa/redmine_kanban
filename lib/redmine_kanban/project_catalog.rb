require 'set'

module RedmineKanban
  module PreloadedMembershipLookup
    def membership(project)
      project_id = project.is_a?(Project) ? project.id : project
      cached = @redmine_kanban_catalog_memberships
      return cached[project_id] if cached&.key?(project_id)

      super
    end
  end

  class ProjectCatalog
    def initialize(user:, board_project: nil)
      @user = user
      @board_project = board_project
    end

    def subtree_projects(root:)
      build_project_list(
        root.self_and_descendants.visible(@user).to_a.select(&:active?),
        base_depth: project_depths([root]).fetch(root.id),
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

    def with_preloaded_permission_context(projects)
      had_cache = @user.instance_variable_defined?(:@redmine_kanban_catalog_memberships)
      previous_cache = @user.instance_variable_get(:@redmine_kanban_catalog_memberships) if had_cache
      preload_permission_context(projects)
      yield
    ensure
      if had_cache
        @user.instance_variable_set(:@redmine_kanban_catalog_memberships, previous_cache)
      elsif @user.instance_variable_defined?(:@redmine_kanban_catalog_memberships)
        @user.remove_instance_variable(:@redmine_kanban_catalog_memberships)
      end
    end

    private

    def visible_projects
      @visible_projects ||= Project.visible(@user).includes(:enabled_modules).to_a.select(&:active?).sort_by(&:lft)
    end

    def viewable_project_records
      @viewable_project_records ||= visible_projects
    end

    def creatable_project_records
      @creatable_project_records ||= begin
        if @board_project && !permission_policy.can_manage_board?(@board_project)
          []
        else
          with_preloaded_permission_context(visible_projects) do
            visible_projects.select { |project| can_create_issue?(project) }
          end
        end
      end
    end

    def build_project_list(projects, base_depth: nil)
      depths = project_depths(projects)
      projects.map do |project|
        {
          id: project.id,
          name: project.name,
          level: depths.fetch(project.id) - (base_depth || 0),
        }
      end
    end

    def project_depths(projects)
      @project_depths ||= {}
      ids = (visible_projects.map(&:id) | projects.map(&:id)) - @project_depths.keys
      if ids.any?
        @project_depths.merge!(
          Project.where(id: ids)
                 .joins('LEFT OUTER JOIN projects AS kanban_ancestors ON kanban_ancestors.lft < projects.lft AND kanban_ancestors.rgt > projects.rgt')
                 .group('projects.id')
                 .count('kanban_ancestors.id')
        )
      end
      @project_depths
    end

    def can_create_issue?(project)
      permission_policy.can_create_issue?(project, @board_project || project)
    end

    def permission_policy
      @permission_policy ||= PermissionPolicy.new(user: @user)
    end

    def preload_permission_context(projects)
      return if @user.admin? || projects.empty?

      project_ids = projects.map(&:id).uniq
      memberships = @user.memberships.where(project_id: project_ids).includes(:roles).index_by(&:project_id)
      unless @user.singleton_class.ancestors.include?(PreloadedMembershipLookup)
        @user.singleton_class.prepend(PreloadedMembershipLookup)
      end
      cached = (@user.instance_variable_get(:@redmine_kanban_catalog_memberships) || {}).dup
      project_ids.each { |id| cached[id] = memberships[id] }
      @user.instance_variable_set(:@redmine_kanban_catalog_memberships, cached)

      public_nonmember_ids = projects.filter_map do |project|
        project.id if project.is_public? && !memberships.key?(project.id)
      end.to_set
      overrides = if public_nonmember_ids.empty?
        {}
      else
        Member.joins(:principal)
              .where(project_id: public_nonmember_ids.to_a, users: { type: %w[GroupAnonymous GroupNonMember] })
              .includes(:principal, :roles)
              .group_by(&:project_id)
      end
      projects.each do |project|
        next unless public_nonmember_ids.include?(project.id)

        project.instance_variable_set(:@override_members, overrides.fetch(project.id, []))
      end
    end
  end
end
