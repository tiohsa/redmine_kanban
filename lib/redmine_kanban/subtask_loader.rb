require 'set'

module RedmineKanban
  class SubtaskLoader
    attr_reader :loaded_issue_ids, :fetched_row_count, :query_count, :truncated_parent_ids

    def initialize(user:, project_ids: nil, max_nodes: nil, root_issue_ids: [])
      @user = user
      @project_ids = Array(project_ids).filter_map { |id| id.to_i.positive? ? id.to_i : nil }.uniq
      @max_nodes = max_nodes.nil? ? nil : [max_nodes.to_i, 0].max
      @root_issue_ids = Array(root_issue_ids).compact.uniq
      @loaded_issue_ids = []
      @fetched_row_count = 0
      @query_count = 0
      @truncated_parent_ids = []
      @truncated = false
    end

    def subtasks_by_parent_id(root_issue_ids = @root_issue_ids)
      fetch(root_issue_ids).group_by(&:parent_id)
    end

    def truncated?
      @truncated
    end

    private

    def fetch(root_issue_ids)
      root_ids = Array(root_issue_ids).compact.uniq
      root_id_set = Set.new(root_ids)
      parent_ids = root_ids
      subtasks = []
      selected_ids = Set.new
      selected_parent_by_child = {}
      expanded_parent_ids = Set.new
      remaining_nodes = @max_nodes

      until parent_ids.empty?
        parents = parent_ids.compact.uniq.reject { |parent_id| expanded_parent_ids.include?(parent_id) }
        break if parents.empty?

        parents = parents_with_children(parents) if parents.length > 1
        break if parents.empty?

        parents_left = parents.length
        next_parent_ids = []

        parents.each do |parent_id|
          allocation = allocation_for(remaining_nodes, parents_left)
          allocation_remaining = allocation
          query_limit = query_limit_for(allocation)
          children = fetch_children(parent_id, query_limit)
          expanded_parent_ids.add(parent_id)
          parents_left -= 1

          candidates = children.reject do |child|
            selected_ids.include?(child.id) || (expanded_parent_ids.include?(child.id) && !root_id_set.include?(child.id))
          end
          accepted = []

          candidates.each do |child|
            costs_budget = !root_id_set.include?(child.id)
            if creates_cycle?(child.id, parent_id, selected_parent_by_child)
              next
            end

            if !@max_nodes || !costs_budget || allocation_remaining.to_i.positive?
              accepted << child
              selected_ids.add(child.id)
              selected_parent_by_child[child.id] = parent_id
              @loaded_issue_ids << child.id
              if @max_nodes && costs_budget
                allocation_remaining -= 1
                remaining_nodes -= 1
              end
            else
              mark_truncated(parent_id)
              break
            end
          end

          if query_limit && children.size == query_limit
            excluded_ids = root_id_set | selected_ids | children.map(&:id).to_set
            mark_truncated(parent_id) if more_children?(parent_id, excluded_ids)
          end

          subtasks.concat(accepted)
          next_parent_ids.concat(accepted.map(&:id))
        end

        parent_ids = next_parent_ids
      end

      subtasks
    end

    def fetch_children(parent_id, query_limit)
      scope = Issue.visible(@user).where(parent_id: parent_id)
      scope = scope.where(project_id: @project_ids) if @project_ids.any?
      scope = scope.includes(:assigned_to, :priority, :status, :project)
                   .order(:parent_id, :lft, :id)
      scope = scope.limit(query_limit) if query_limit
      children = scope.to_a
      @query_count += 1
      @fetched_row_count += children.size
      children
    end

    def allocation_for(remaining_nodes, parents_left)
      return nil if remaining_nodes.nil?
      return 0 if parents_left <= 0

      (remaining_nodes / parents_left) + ((remaining_nodes % parents_left).positive? ? 1 : 0)
    end

    def query_limit_for(allocation)
      return nil if allocation.nil?

      allocation + 1
    end

    def parents_with_children(parent_ids)
      scope = Issue.visible(@user).where(parent_id: parent_ids)
      scope = scope.where(project_id: @project_ids) if @project_ids.any?
      existing_ids = scope.distinct.pluck(:parent_id).to_set
      ids = parent_ids.select { |parent_id| existing_ids.include?(parent_id) }
      @query_count += 1
      @fetched_row_count += ids.size
      ids
    end

    def more_children?(parent_id, excluded_ids)
      scope = Issue.visible(@user).where(parent_id: parent_id)
      scope = scope.where(project_id: @project_ids) if @project_ids.any?
      has_more = scope.where.not(id: excluded_ids.to_a).exists?
      @query_count += 1
      @fetched_row_count += 1 if has_more
      has_more
    end

    def mark_truncated(parent_id)
      @truncated = true
      @truncated_parent_ids << parent_id unless @truncated_parent_ids.include?(parent_id)
    end

    def creates_cycle?(child_id, parent_id, selected_parent_by_child)
      visited = Set.new([child_id])
      current = parent_id
      until visited.include?(current)
        visited.add(current)
        next_parent = selected_parent_by_child[current]
        return false unless next_parent

        current = next_parent
      end
      true
    end
  end
end
