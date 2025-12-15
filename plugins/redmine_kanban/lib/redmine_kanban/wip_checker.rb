module RedmineKanban
  class WipChecker
    def initialize(project:, settings:, user:)
      @project = project
      @settings = settings
      @user = user
    end

    def check_move(issue:, target_status_id:, target_assigned_to_id:)
      limit = @settings.wip_limits[target_status_id].to_i
      return ok if limit <= 0

      mode = @settings.wip_limit_mode
      count = wip_count(issue: issue, target_status_id: target_status_id, target_assigned_to_id: target_assigned_to_id, mode: mode)

      if count >= limit && would_increase?(issue, target_status_id, target_assigned_to_id, mode)
        if @settings.wip_exceed_behavior == 'warn'
          return ok(message: "WIP上限（#{limit}）を超過します")
        end
        return blocked(message: "WIP上限（#{limit}）を超過しています")
      end

      ok
    end

    private

    def wip_count(issue:, target_status_id:, target_assigned_to_id:, mode:)
      relation = Issue.visible(@user).where(project_id: @project.id, status_id: target_status_id)
      if mode == 'column_lane'
        relation = relation.where(assigned_to_id: target_assigned_to_id)
      end
      relation = relation.where.not(id: issue.id)
      relation.count
    end

    def would_increase?(issue, target_status_id, target_assigned_to_id, mode)
      return true if issue.status_id != target_status_id
      return false if mode != 'column_lane'

      issue.assigned_to_id != target_assigned_to_id
    end

    def ok(message: nil)
      { blocked: false, message: message }
    end

    def blocked(message:)
      { blocked: true, message: message }
    end
  end
end
