module RedmineKanban
  module AncestorIssueUpdates
    private

    def ancestor_updates_for(issue)
      ancestor_issues_for(issue).map do |ancestor|
        {
          id: ancestor.id,
          done_ratio: ancestor.done_ratio,
          lock_version: ancestor.lock_version,
          updated_on: ancestor.updated_on&.iso8601,
          aging_days: BoardIssuePresenter.aging_days_for(ancestor)
        }
      end
    end

    def ancestor_issues_for(issue)
      issue.ancestors.filter_map do |ancestor|
        next unless ancestor.visible?(@user)

        ancestor.reload
      end
    end
  end
end
