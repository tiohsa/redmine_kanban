module RedmineKanban
  # Recovery choices must remain available even when the snapshot exceeds its limits.
  # Candidate lists are built from project membership/configuration, never Issues.
  class BoardMetadata
    def initialize(project:, user:)
      @project = project
      @user = user
    end

    def to_h
      catalog = ProjectCatalog.new(user: @user, board_project: @project)
      projects = catalog.subtree_projects(root: @project)
      viewable_projects = catalog.viewable_projects
      {
        ok: true,
        board: { id: @project.id, identifier: @project.identifier, name: @project.name },
        server_entity_limit: SnapshotLimits.server_entity_limit,
        projects: projects,
        viewable_projects: viewable_projects,
        statuses: IssueStatus.sorted.map { |status| { id: status.id, name: status.name, is_closed: status.is_closed } },
        filter_options: BoardFilterOptionsBuilder.new(
          project_ids: viewable_projects.map { |project| project[:id] }, user: @user
        ).build
      }
    end
  end
end
