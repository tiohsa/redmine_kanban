require 'set'

module RedmineKanban
  class SubtaskLoader
    def initialize(user:)
      @user = user
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
