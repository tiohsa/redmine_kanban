require 'set'

module RedmineKanban
  class SubtaskLoader
    def initialize(user:, project_ids: nil)
      @user = user
      @project_ids = Array(project_ids).filter_map { |id| id.to_i.positive? ? id.to_i : nil }.uniq
    end

    def subtasks_by_parent_id(root_issue_ids)
      fetch(root_issue_ids).group_by(&:parent_id)
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
        break if new_children.empty?

        subtasks.concat(new_children)
        new_children.each { |issue| visited_ids.add(issue.id) }
        parent_ids = new_children.map(&:id)
      end

      subtasks
    end
  end
end
