module RedmineKanban
  module IssueWorkflow
    private

    def status_allowed_for?(issue, status_id)
      return true if status_id == issue.status_id

      issue.new_statuses_allowed_to(@user).map(&:id).include?(status_id)
    end
  end
end
