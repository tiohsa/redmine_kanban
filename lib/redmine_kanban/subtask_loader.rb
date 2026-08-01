require 'set'

module RedmineKanban
  class SubtaskLoader
    attr_reader :loaded_issue_ids, :fetched_row_count, :query_count, :truncated_parent_ids, :unexpanded_parent_ids, :last_child_id_by_parent, :loaded_parent_id_by_issue, :batch_count, :max_depth_reached

    def initialize(user:, project_ids: nil, max_nodes: nil, root_issue_ids: [], max_depth: 32, max_queries: 40)
      @user = user
      @project_ids = Array(project_ids).filter_map { |id| id.to_i.positive? ? id.to_i : nil }.uniq
      @max_nodes = max_nodes.nil? ? nil : [max_nodes.to_i, 0].max
      @root_issue_ids = Array(root_issue_ids).compact.uniq
      @max_depth = [max_depth.to_i, 0].max
      @max_queries = [max_queries.to_i, 1].max
      @loaded_issue_ids = []
      @fetched_row_count = 0
      @query_count = 0
      @truncated_parent_ids = []
      @unexpanded_parent_ids = []
      @last_child_id_by_parent = {}
      @loaded_parent_id_by_issue = {}
      @batch_count = 0
      @max_depth_reached = 0
      @truncated = false
    end

    def subtasks_by_parent_id(root_issue_ids = @root_issue_ids)
      fetch(root_issue_ids).group_by(&:parent_id)
    end

    def truncated?
      @truncated || @unexpanded_parent_ids.any?
    end

    private

    def fetch(root_issue_ids)
      root_ids = Array(root_issue_ids).compact.uniq
      root_id_set = Set.new(root_ids)
      frontier_parent_ids = root_ids
      subtasks = []
      selected_ids = Set.new
      selected_parent_by_child = {}
      remaining_nodes = @max_nodes
      depth = 0

      until frontier_parent_ids.empty?
        parents = frontier_parent_ids.compact.uniq
        break if parents.empty?
        if depth >= @max_depth || @query_count >= @max_queries
          parents.each { |parent_id| mark_unexpanded(parent_id) }
          break
        end
        if @max_nodes && remaining_nodes <= 0
          known_root_parents = parents.select { |parent_id| root_id_set.include?(parent_id) }
          if known_root_parents.any?
            # A known root may still be traversed without spending the node
            # budget. Its children are fetched by the normal batch below.
          else
            parents_with_children = parents_with_children(parents)
            parents_with_children.each { |parent_id| mark_truncated(parent_id) }
            parents.each { |parent_id| mark_unexpanded(parent_id) if parents_with_children.exclude?(parent_id) && @max_depth <= depth }
            break
          end
        end

        allocation_by_parent = parents.to_h do |parent_id|
          [parent_id, allocation_for(remaining_nodes, parents.length)]
        end
        query_limit = query_limit_for_batch(remaining_nodes, parents.length)
        @batch_count += 1
        @max_depth_reached = depth
        rows = fetch_children_batch(parents, query_limit)
        rows_by_parent = rows.group_by(&:parent_id)
        mark_limit_starved_parents(parents, rows_by_parent, query_limit)
        next_parent_ids = []

        parents.each do |parent_id|
          allocation = allocation_by_parent.fetch(parent_id)
          allocation_remaining = allocation
          candidates = rows_by_parent.fetch(parent_id, [])
          accepted = []

          candidates.each do |child|
            costs_budget = !root_id_set.include?(child.id)
            if selected_ids.include?(child.id) || creates_cycle?(child.id, parent_id, selected_parent_by_child)
              next
            end

            if !@max_nodes || !costs_budget || allocation_remaining.to_i.positive?
              accepted << child
              selected_ids.add(child.id)
              selected_parent_by_child[child.id] = parent_id
              @loaded_issue_ids << child.id
              @loaded_parent_id_by_issue[child.id] = parent_id
              if @max_nodes && costs_budget
                allocation_remaining -= 1
                remaining_nodes -= 1
              end
            else
              mark_truncated(parent_id)
              break
            end
          end

          @last_child_id_by_parent[parent_id] = accepted.last.id if accepted.any?

          budget_candidate_count = candidates.count { |candidate| !root_id_set.include?(candidate.id) }
          exceeds_allocation = allocation && budget_candidate_count > allocation
          mark_truncated(parent_id) if exceeds_allocation

          subtasks.concat(accepted)
          # A root that is also discovered as a child is already present in
          # this breadth level. Re-enqueuing it would spend another depth and
          # can falsely mark a fully materialized known-root branch as
          # truncated when the node budget is exhausted.
          next_parent_ids.concat(accepted.reject { |child| root_id_set.include?(child.id) }.map(&:id))
        end

        frontier_parent_ids = next_parent_ids
        depth += 1
      end

      subtasks
    end

    def fetch_children_batch(parent_ids, query_limit)
      scope = Issue.visible(@user).where(parent_id: parent_ids)
      scope = scope.where(project_id: @project_ids) if @project_ids.any?
      scope = scope.includes(:assigned_to, :priority, :status, :project)
                   .order(:parent_id, :lft, :id)
      scope = scope.limit(query_limit) if query_limit
      children = scope.to_a
      @query_count += 1
      @fetched_row_count += children.size
      children
    end

    def mark_limit_starved_parents(parent_ids, rows_by_parent, query_limit)
      return unless query_limit && rows_by_parent.values.sum(&:size) >= query_limit

      missing_parent_ids = parent_ids.reject { |parent_id| rows_by_parent.key?(parent_id) }
      return if missing_parent_ids.empty?

      recoverable_parent_ids = if @query_count < @max_queries
                                parents_with_children(missing_parent_ids)
                              else
                                missing_parent_ids
                              end
      recoverable_parent_ids.each { |parent_id| mark_truncated(parent_id) }
      if @query_count >= @max_queries && recoverable_parent_ids.empty?
        missing_parent_ids.each { |parent_id| mark_unexpanded(parent_id) }
      end
    end

    def parents_with_children(parent_ids)
      scope = Issue.visible(@user).where(parent_id: parent_ids)
      scope = scope.where(project_id: @project_ids) if @project_ids.any?
      @query_count += 1
      scope.distinct.pluck(:parent_id).map(&:to_i)
    end

    def query_limit_for_batch(remaining_nodes, parent_count)
      return nil if remaining_nodes.nil?

      remaining_nodes + parent_count
    end

    def allocation_for(remaining_nodes, parents_left)
      return nil if remaining_nodes.nil?
      return 0 if parents_left <= 0

      (remaining_nodes / parents_left) + ((remaining_nodes % parents_left).positive? ? 1 : 0)
    end

    def mark_truncated(parent_id)
      @truncated = true
      @truncated_parent_ids << parent_id unless @truncated_parent_ids.include?(parent_id)
    end

    def mark_unexpanded(parent_id)
      @unexpanded_parent_ids << parent_id unless @unexpanded_parent_ids.include?(parent_id)
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
