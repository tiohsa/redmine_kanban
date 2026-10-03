require_relative 'project_catalog'
require_relative 'snapshot_limits'
require 'digest'
require 'json'
require_relative 'board_issue_filter'

module RedmineKanban
  class BoardContext
    attr_reader :project, :user, :project_ids, :scope_status_ids, :dependency_status_ids,
                :issue_filter,
                :requested_entity_limit, :effective_entity_limit, :server_entity_limit,
                :response_byte_limit, :query_limit, :total_query_limit

    def initialize(project:, user:, project_ids: nil, scope_status_ids: nil, issue_status_ids: nil, exclude_status_ids: nil, dependency_status_ids: nil, board_entity_limit: nil, issue_filter: nil)
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
      @issue_filter = issue_filter || BoardIssueFilter.new
      @requested_entity_limit = SnapshotLimits.requested(board_entity_limit)
      @effective_entity_limit = SnapshotLimits.effective(@requested_entity_limit)
      @server_entity_limit = SnapshotLimits.server_entity_limit
      @response_byte_limit = SnapshotLimits.response_bytes
      @query_limit = SnapshotLimits.query_limit
      @total_query_limit = SnapshotLimits.total_query_limit
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
        dependency_status_ids: @dependency_status_ids.sort,
        filter_scope: @issue_filter.scope
      }.to_json)}"
    end

    def filter_scope
      @issue_filter.scope
    end

    def filter_membership_changed?(changed_fields)
      return false unless @issue_filter.active?
      fields = Array(changed_fields).map(&:to_sym)
      return true if fields.include?(:status_id)

      scope = filter_scope
      (scope[:q].present? && fields.include?(:subject)) ||
        ((scope[:assignee_ids].any? || scope[:include_unassigned]) && fields.include?(:assigned_to_id)) ||
        (scope[:tracker_ids].any? && fields.include?(:tracker_id)) ||
        (scope[:priority_filter_enabled] && fields.include?(:priority_id)) ||
        (scope[:due] != 'all' && fields.include?(:due_date))
    end

    private

    def sanitize_project_ids(ids)
      allowed_ids = ProjectCatalog.new(user: @user).viewable_project_ids
      Array(ids).filter_map { |id| id.to_i if id.to_i.positive? && allowed_ids.include?(id.to_i) }.uniq
    end
  end
end
