require 'set'

module RedmineKanban
  class SubtaskLoader
    attr_reader :loaded_issue_ids

    def initialize(user:, project_ids: nil, max_nodes: nil)
      @user = user
      @project_ids = Array(project_ids).filter_map { |id| id.to_i.positive? ? id.to_i : nil }.uniq
      @max_nodes = max_nodes.nil? ? nil : [max_nodes.to_i, 0].max
      @loaded_issue_ids = []
      @truncated = false
    end

    def subtasks_by_parent_id(root_issue_ids)
      fetch(root_issue_ids).group_by(&:parent_id)
    end

    def truncated?
      @truncated
    end

    private

    def fetch(root_issue_ids)
      parent_ids = root_issue_ids.compact.uniq
      subtasks = []
      visited_ids = Set.new

      until parent_ids.empty?
        children = Issue.visible(@user)
                        .where(parent_id: parent_ids)
                        .then { |scope| @project_ids.any? ? scope.where(project_id: @project_ids) : scope }
                        .includes(:assigned_to, :priority, :status, :project)
                        .order(:parent_id, :lft, :id)
                        .to_a

        new_children = children.reject { |issue| visited_ids.include?(issue.id) }
        if @max_nodes
          remaining = @max_nodes - subtasks.size
          if remaining <= 0
            @truncated = new_children.any?
            break
          end
          @truncated ||= new_children.size > remaining
          new_children = new_children.first(remaining)
        end
        break if new_children.empty?

        subtasks.concat(new_children)
        @loaded_issue_ids.concat(new_children.map(&:id))
        new_children.each { |issue| visited_ids.add(issue.id) }
        parent_ids = new_children.map(&:id)
      end

      subtasks
    end
  end
end
