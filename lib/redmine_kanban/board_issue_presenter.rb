require 'set'

module RedmineKanban
  class BoardIssuePresenter
    def initialize(user:, subtasks_by_parent_id: {}, board_project: nil)
      @user = user
      @subtasks_by_parent_id = subtasks_by_parent_id
      @board_project = board_project
      @serialized_ids = Set.new
    end

    def issue_to_h(issue)
      issues_to_h([issue]).first
    end

    def issues_to_h(issues)
      @serialized_ids = Set.new
      Array(issues).filter_map { |issue| issue_to_h_without_reset(issue) }
    end

    def issue_to_h_without_reset(issue)
      return if @serialized_ids.include?(issue.id)

      @serialized_ids.add(issue.id)
      {
        id: issue.id,
        parent_id: issue.parent_id,
        subject: issue.subject,
        status_id: issue.status_id,
        can_log_time: permission_policy.can_log_time?(issue.project),
        lock_version: issue.lock_version,
        status_name: issue.status&.name,
        status_is_closed: issue.status&.is_closed,
        tracker_id: issue.tracker_id,
        description: issue.description,
        assigned_to_id: issue.assigned_to_id,
        assigned_to_name: issue.assigned_to&.name,
        start_date: issue.start_date&.to_s,
        due_date: issue.due_date&.to_s,
        priority_id: issue.priority_id,
        priority_name: issue.priority&.name,
        done_ratio: issue.done_ratio,
        updated_on: updated_on_for(issue)&.iso8601,
        aging_days: self.class.aging_days_for(issue),
        project: { id: issue.project_id, name: issue.project.name },
        permissions: permissions_for(issue),
        allowed_status_ids: allowed_status_ids_for(issue),
        subtasks: subtask_tree(issue, Set[issue.id]),
        urls: {
          issue: Rails.application.routes.url_helpers.issue_path(issue),
          issue_edit: Rails.application.routes.url_helpers.edit_issue_path(issue),
        },
      }
    end

    def self.aging_days_for(issue)
      return 0 unless issue.respond_to?(:updated_on) && issue.updated_on

      (Date.current - issue.updated_on.to_date).to_i
    end

    private

    def subtask_tree(issue, visited_ids)
      result = []
      stack = [{
        parent_id: issue.id,
        visited_ids: visited_ids.is_a?(Set) ? visited_ids : Set.new(visited_ids),
        children: nil,
        index: 0,
        target: result
      }]

      until stack.empty?
        frame = stack.last
        frame[:children] ||= @subtasks_by_parent_id[frame[:parent_id]] || []
        if frame[:index] >= frame[:children].length
          stack.pop
          next
        end

        child = frame[:children][frame[:index]]
        frame[:index] += 1
        next if frame[:visited_ids].include?(child.id) || @serialized_ids.include?(child.id)

        @serialized_ids.add(child.id)
        child_hash = subtask_to_h(child)
        frame[:target] << child_hash
        child_visited_ids = frame[:visited_ids].dup
        child_visited_ids.add(child.id)
        stack << {
          parent_id: child.id,
          visited_ids: child_visited_ids,
          children: nil,
          index: 0,
          target: child_hash[:subtasks]
        }
      end

      result
    end

    def subtask_to_h(issue)
      {
        id: issue.id,
        subject: issue.subject,
        status_id: issue.status_id,
        tracker_id: issue.tracker_id,
        assigned_to_id: issue.assigned_to_id,
        due_date: issue.due_date&.to_s,
        priority_id: issue.priority_id,
        is_closed: issue.status.is_closed?,
        lock_version: issue.lock_version,
        updated_on: updated_on_for(issue)&.iso8601,
        done_ratio: issue.respond_to?(:done_ratio) ? issue.done_ratio : nil,
        aging_days: self.class.aging_days_for(issue),
        project: { id: issue.project.id, name: issue.project.name },
        permissions: permissions_for(issue),
        allowed_status_ids: allowed_status_ids_for(issue),
        subtasks: [],
      }
    end

    def permissions_for(issue)
      project = issue.project
      {
        can_move: permission_policy.can_move_issue?(issue, @board_project || project),
        can_edit: permission_policy.can_update_issue?(issue, @board_project || project),
        can_delete: permission_policy.can_delete_issue?(issue, @board_project || project),
      }
    end

    def allowed_status_ids_for(issue)
      statuses = issue.respond_to?(:new_statuses_allowed_to) ? issue.new_statuses_allowed_to(@user) : []
      ([issue.status] + statuses).compact.map(&:id).uniq
    end

    def permission_policy
      @permission_policy ||= PermissionPolicy.new(user: @user)
    end

    def updated_on_for(issue)
      issue.updated_on if issue.respond_to?(:updated_on)
    end
  end
end
