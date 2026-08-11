require_relative 'project_catalog'
require_relative 'snapshot_limits'
require 'digest'
require 'json'

module RedmineKanban
  class BoardContext
    attr_reader :project, :user, :project_ids, :scope_status_ids, :dependency_status_ids,
                :requested_entity_limit, :effective_entity_limit, :server_entity_limit,
                :response_byte_limit, :query_limit

    def initialize(project:, user:, project_ids: nil, scope_status_ids: nil, issue_status_ids: nil, exclude_status_ids: nil, dependency_status_ids: nil, board_entity_limit: nil)
      @project = project
      @user = user
      @project_ids = sanitize_project_ids(project_ids).presence || [@project.id]
      all_status_ids = IssueStatus.sorted.pluck(:id)
      requested_status_ids = if dependency_status_ids
        Array(dependency_status_ids)
      elsif scope_status_ids.nil?
        Array(issue_status_ids).presence || all_status_ids
      else
        Array(scope_status_ids)
      end
      @dependency_status_ids = requested_status_ids.map(&:to_i).select(&:positive?).uniq & all_status_ids
      @scope_status_ids = if scope_status_ids.nil? && dependency_status_ids.nil?
        @dependency_status_ids - Array(exclude_status_ids).map(&:to_i).select(&:positive?).uniq
      else
        Array(scope_status_ids || @dependency_status_ids).map(&:to_i).select(&:positive?).uniq & all_status_ids
      end
      @dependency_status_ids |= @scope_status_ids
      @requested_entity_limit = SnapshotLimits.requested(board_entity_limit)
      @effective_entity_limit = SnapshotLimits.effective(@requested_entity_limit)
      @server_entity_limit = SnapshotLimits.server_entity_limit
      @response_byte_limit = SnapshotLimits.response_bytes
      @query_limit = SnapshotLimits.query_limit
    end

    def presenter(_root_issue_ids = [])
      [
        BoardIssuePresenter.new(
          user: @user,
          board_project: @project
        ),
        nil
      ]
    end

    def scope_fingerprint
      @scope_fingerprint ||= "sha256:#{Digest::SHA256.hexdigest({
        board_project_id: @project.id,
        user_id: @user.id,
        project_ids: @project_ids.sort,
        scope_status_ids: @scope_status_ids.sort,
        dependency_status_ids: @dependency_status_ids.sort
      }.to_json)}"
    end

    private

    def sanitize_project_ids(ids)
      allowed_ids = ProjectCatalog.new(user: @user).viewable_project_ids
      Array(ids).filter_map { |id| id.to_i if id.to_i.positive? && allowed_ids.include?(id.to_i) }.uniq
    end
  end
end
