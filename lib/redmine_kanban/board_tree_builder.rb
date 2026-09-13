require 'set'

module RedmineKanban
  class BoardTreeBuilder
    def initialize(issues)
      @issues = issues
    end

    def build
      issues = @issues
      issue_ids = issues.map(&:id).to_set
      children_by_parent_id = Hash.new { |hash, key| hash[key] = [] }
      roots = []
      parent_by_id = {}

      issues.each do |issue|
        parent_id = issue.parent_id.to_i if issue.parent_id.present?
        if parent_id && issue_ids.include?(parent_id) && parent_id != issue.id
          parent_by_id[issue.id] = parent_id
          children_by_parent_id[parent_id] << issue.id
        else
          roots << issue.id
        end
      end

      parent_by_id.to_a.each do |child_id, parent_id|
        seen = Set.new([child_id])
        current = parent_id
        while current
          if seen.include?(current)
            children_by_parent_id[parent_id].delete(child_id)
            parent_by_id.delete(child_id)
            roots << child_id
            break
          end
          seen.add(current)
          current = parent_by_id[current]
        end
      end

      issues_by_id = issues.index_by(&:id)
      children_by_parent_id.each_value do |ids|
        ids.sort_by! do |id|
          updated_on = issues_by_id.fetch(id).updated_on
          [updated_on ? -updated_on.to_i : 0, id]
        end
      end
      {
        root_ids: roots.uniq,
        children_by_parent_id: children_by_parent_id.each_with_object({}) { |(parent_id, child_ids), tree| tree[parent_id.to_s] = child_ids }
      }
    end
  end
end
