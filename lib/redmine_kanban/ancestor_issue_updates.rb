module RedmineKanban
  module AncestorIssueUpdates
    private

    def ancestor_updates_for(issue)
      issue.ancestors.filter_map do |ancestor|
        next unless ancestor.visible?(@user)

        ancestor.reload
        {
          id: ancestor.id,
          done_ratio: ancestor.done_ratio,
          lock_version: ancestor.lock_version,
          updated_on: ancestor.updated_on&.iso8601
        }
      end
    end
  end
end
