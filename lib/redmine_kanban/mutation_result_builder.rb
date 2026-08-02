require 'securerandom'
require_relative 'issue_entity_presenter'

module RedmineKanban
  class MutationResultBuilder
    def initialize(board_context:, operation_id: nil)
      @board_context = board_context
      @operation_id = operation_id.presence || SecureRandom.uuid
      @presenter = IssueEntityPresenter.new(user: board_context.user, board_project: board_context.project)
    end

    def build(issue_updates: [], created_issues: [], deleted_issue_ids: [], tree_changes: [], invalidations: {}, column_counts: {})
      {
        ok: true,
        contract_version: 2,
        operation_id: @operation_id,
        scope_fingerprint: @board_context.scope_fingerprint,
        issue_updates: @presenter.issues_to_h(issue_updates),
        created_issues: @presenter.issues_to_h(created_issues),
        deleted_issue_ids: Array(deleted_issue_ids).map(&:to_i).uniq,
        tree_changes: Array(tree_changes),
        invalidations: {
          issue_ids: Array(invalidations[:issue_ids]).map(&:to_i).uniq,
          parent_ids: Array(invalidations[:parent_ids]).map(&:to_i).uniq,
          column_counts: !!invalidations[:column_counts],
          root_order: !!invalidations[:root_order]
        },
        column_counts: column_counts
      }
    end
  end
end
