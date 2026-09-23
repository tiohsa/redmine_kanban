module RedmineKanban
  # Recovery choices must remain available even when the snapshot exceeds its limits.
  # Do not load Issues, aggregate counts, or assignable users here.
  class BoardMetadata
    def initialize(project:, user:)
      @project = project
      @user = user
    end

    def to_h
      catalog = ProjectCatalog.new(user: @user, board_project: @project)
      {
        ok: true,
        board: { id: @project.id, identifier: @project.identifier, name: @project.name },
        server_entity_limit: SnapshotLimits.server_entity_limit,
        projects: catalog.subtree_projects(root: @project),
        viewable_projects: catalog.viewable_projects,
        statuses: IssueStatus.sorted.map { |status| { id: status.id, name: status.name, is_closed: status.is_closed } }
      }
    end
  end
end
