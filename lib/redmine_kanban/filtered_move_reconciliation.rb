require_relative 'board_membership_resolver'

module RedmineKanban
  # Capture the affected family before saving, then reconcile its filtered
  # membership after all Redmine parent/priority callbacks have completed.
  class FilteredMoveReconciliation
    def initialize(board_context:, issue:)
      @resolver = BoardMembershipResolver.new(board_context: board_context)
      @family = @resolver.filtered_move_candidate_ids(issue, limit: board_context.effective_entity_limit)
      @before_ids = @resolver.member_ids(@family[:ids]) unless @family[:overflow]
    end

    def result
      return { overflow: true } if @family[:overflow]

      after_ids = @resolver.member_ids(@family[:ids])
      entered_ids = after_ids - @before_ids
      {
        overflow: false,
        issue_updates: @resolver.membership_candidate_issues(@family[:ancestor_ids]),
        membership_recheck_ids: (@before_ids ^ after_ids).to_a,
        tree_changes: @resolver.entering_tree_changes(after_ids.to_a, entered_ids: entered_ids.to_a)
      }
    end
  end
end
