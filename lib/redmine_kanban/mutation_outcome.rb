module RedmineKanban
  module MutationOutcome
    private

    def mutation_outcome_for(issue)
      {
        status_changed: issue.saved_change_to_status_id?,
        assigned_to_changed: issue.saved_change_to_assigned_to_id?,
        done_ratio_changed: issue.saved_change_to_done_ratio?
      }.freeze
    end
  end
end
