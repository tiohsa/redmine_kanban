require_relative 'mutation_result_builder'

module RedmineKanban
  class MutationFinalizer
    def initialize(board_context:, operation_id: nil)
      @board_context = board_context
      @mutation_result_builder = MutationResultBuilder.new(board_context: board_context, operation_id: operation_id)
    end

    def build(issue:, issue_updates:, membership_recheck_ids:, ancestor_updates:, invalidations:)
      result = @mutation_result_builder.build(
        issue_updates: issue_updates,
        membership_recheck_ids: membership_recheck_ids,
        invalidations: invalidations
      ).merge(issue: @board_context.presenter([issue.id]).first.issue_to_h(issue))
      result[:ancestor_updates] = ancestor_updates if ancestor_updates&.any?
      result
    end
  end
end
