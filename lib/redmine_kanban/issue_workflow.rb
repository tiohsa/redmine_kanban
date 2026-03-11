module RedmineKanban
  module IssueWorkflow
    private

    def status_allowed_for?(issue, status_id)
      return true if status_id == issue.status_id

      issue.new_statuses_allowed_to(@user).map(&:id).include?(status_id)
    end

    def check_wip!(issue:, status_id:, assigned_to_id:)
      WipChecker.new(project: @project, settings: @settings, user: @user).check_move(
        issue: issue,
        target_status_id: status_id,
        target_assigned_to_id: assigned_to_id,
      )
    end
  end
end
