module RedmineKanban
  # Recovery choices must remain available even when the snapshot exceeds its limits.
  # Candidate lists are built from project membership/configuration, never Issues.
  class BoardMetadata
    def initialize(project:, user:, project_ids: nil)
      @project = project
      @user = user
      @project_ids = project_ids
    end

    def to_h
      catalog = ProjectCatalog.new(user: @user, board_project: @project)
      projects = catalog.subtree_projects(root: @project)
      viewable_projects = catalog.viewable_projects
      metadata = {
        ok: true,
        board: { id: @project.id, identifier: @project.identifier, name: @project.name },
        server_entity_limit: SnapshotLimits.server_entity_limit,
        projects: projects,
        viewable_projects: viewable_projects,
        statuses: IssueStatus.sorted.map { |status| { id: status.id, name: status.name, is_closed: status.is_closed } }
      }

      metadata.merge!(filter_options_metadata(viewable_project_ids: viewable_projects.map { |project| project[:id] }))
    end

    private

    def filter_options_metadata(viewable_project_ids:)
      requested_ids = Array(@project_ids).map(&:to_i).select(&:positive?).to_set
      project_ids = if @project_ids.nil?
        viewable_project_ids
      else
        viewable_project_ids.select { |id| requested_ids.include?(id) }
      end
      {
        filter_options: BoardFilterOptionsBuilder.new(project_ids: project_ids, user: @user).build,
        filter_options_complete: true
      }
    rescue BoardFilterOptionsBuilder::ResourceLimitExceeded => error
      {
        filter_options: { assignees: [], trackers: [], priorities: [] },
        filter_options_complete: false,
        filter_options_error: {
          code: 'BOARD_FILTER_OPTIONS_TOO_LARGE',
          resource: error.resource,
          limit: error.limit
        }
      }
    end
  end
end
