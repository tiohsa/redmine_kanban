require_relative 'project_catalog'
require_relative 'subtask_loader'
require 'digest'
require 'json'

module RedmineKanban
  class BoardContext
    DEFAULT_TREE_NODE_LIMIT = 1_500
    DEFAULT_TREE_MAX_DEPTH = 32
    DEFAULT_TREE_QUERY_LIMIT = 40

    attr_reader :project, :user, :project_ids, :tree_node_limit

    def initialize(project:, user:, project_ids: nil, tree_node_limit: DEFAULT_TREE_NODE_LIMIT)
      @project = project
      @user = user
      @project_ids = sanitize_project_ids(project_ids).presence || [@project.id]
      @tree_node_limit = [tree_node_limit.to_i, 1].max
    end

    def subtask_loader(root_issue_ids)
      SubtaskLoader.new(
        user: @user,
        project_ids: @project_ids,
        root_issue_ids: root_issue_ids,
        max_nodes: [@tree_node_limit - Array(root_issue_ids).uniq.size, 0].max,
        max_depth: DEFAULT_TREE_MAX_DEPTH,
        max_queries: DEFAULT_TREE_QUERY_LIMIT
      )
    end

    def presenter(root_issue_ids)
      loader = subtask_loader(root_issue_ids)
      [
        BoardIssuePresenter.new(
          user: @user,
          board_project: @project,
          subtasks_by_parent_id: loader.subtasks_by_parent_id(root_issue_ids)
        ),
        loader
      ]
    end

    def scope_fingerprint
      @scope_fingerprint ||= "sha256:#{Digest::SHA256.hexdigest({ project_ids: @project_ids.sort, user_id: @user.id }.to_json)}"
    end

    private

    def sanitize_project_ids(ids)
      allowed_ids = ProjectCatalog.new(user: @user).viewable_project_ids
      Array(ids).filter_map { |id| id.to_i if id.to_i.positive? && allowed_ids.include?(id.to_i) }.uniq
    end
  end
end
