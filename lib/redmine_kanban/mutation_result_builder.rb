require 'securerandom'
require 'set'
require_relative 'issue_entity_presenter'

module RedmineKanban
  class MutationResultBuilder
    def initialize(board_context:, operation_id: nil)
      @board_context = board_context
      @operation_id = operation_id.presence || SecureRandom.uuid
      @presenter = IssueEntityPresenter.new(user: board_context.user, board_project: board_context.project)
    end

    def build(issue_updates: [], created_issues: [], deleted_issue_ids: [], tree_changes: [], invalidations: {}, column_counts: {})
      candidates = [*issue_updates, *created_issues].compact.uniq { |issue| issue.id }
      visible_ids = Issue.visible(@board_context.user)
        .where(id: candidates.map(&:id), project_id: @board_context.project_ids, status_id: @board_context.scope_status_ids)
        .pluck(:id)
      visible_id_set = visible_ids.to_set
      evicted_issue_ids = candidates.map(&:id) - visible_ids
      {
        ok: true,
        contract_version: 3,
        operation_id: @operation_id,
        scope_fingerprint: @board_context.scope_fingerprint,
        issue_updates: @presenter.issues_to_h(issue_updates.select { |issue| visible_id_set.include?(issue.id) }),
        created_issues: @presenter.issues_to_h(created_issues.select { |issue| visible_id_set.include?(issue.id) }),
        deleted_issue_ids: Array(deleted_issue_ids).map(&:to_i).uniq,
        evicted_issue_ids: evicted_issue_ids.uniq,
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
