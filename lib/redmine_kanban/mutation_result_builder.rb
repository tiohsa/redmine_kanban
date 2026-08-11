require 'securerandom'
require 'set'
require 'json'
require_relative 'issue_entity_presenter'
require_relative 'board_membership_resolver'

module RedmineKanban
  class MutationResultBuilder
    def initialize(board_context:, operation_id: nil)
      @board_context = board_context
      @operation_id = operation_id.presence || SecureRandom.uuid
      @presenter = IssueEntityPresenter.new(user: board_context.user, board_project: board_context.project)
    end

    def build(issue_updates: [], created_issues: [], membership_recheck_ids: [], deleted_issue_ids: [], tree_changes: [], invalidations: {}, column_counts: {})
      resolver = BoardMembershipResolver.new(board_context: @board_context)
      admission = resolver.snapshot_issue_ids(limit: @board_context.effective_entity_limit)
      return overflow_result(deleted_issue_ids: deleted_issue_ids, invalidations: invalidations, column_counts: column_counts) if admission[:count_at_least]

      recheck_issues = resolver.membership_candidate_issues(membership_recheck_ids)
      candidates = [*issue_updates, *created_issues, *recheck_issues].compact.uniq { |issue| issue.id }
      member_id_set = resolver.member_ids(candidates)
      evicted_issue_ids = candidates.map(&:id) - member_id_set.to_a
      update_candidates = [*issue_updates, *recheck_issues].compact.uniq { |issue| issue.id }
      result = {
        ok: true,
        contract_version: 3,
        operation_id: @operation_id,
        scope_fingerprint: @board_context.scope_fingerprint,
        issue_updates: @presenter.issues_to_h(update_candidates.select { |issue| member_id_set.include?(issue.id) }),
        created_issues: @presenter.issues_to_h(created_issues.select { |issue| member_id_set.include?(issue.id) }),
        dependency_status_ids: @board_context.dependency_status_ids,
        deleted_issue_ids: Array(deleted_issue_ids).map(&:to_i).uniq,
        evicted_issue_ids: evicted_issue_ids.uniq,
        tree_changes: Array(tree_changes),
        invalidations: {
          issue_ids: Array(invalidations[:issue_ids]).map(&:to_i).uniq,
          parent_ids: Array(invalidations[:parent_ids]).map(&:to_i).uniq,
          column_counts: !!invalidations[:column_counts],
          root_order: !!invalidations[:root_order],
          board_snapshot: !!invalidations[:board_snapshot]
        },
        column_counts: column_counts
      }
      return overflow_result(deleted_issue_ids: deleted_issue_ids, invalidations: invalidations, column_counts: column_counts) if result.to_json.bytesize > @board_context.response_byte_limit

      result
    end

    private

    def overflow_result(deleted_issue_ids:, invalidations:, column_counts:)
      {
        ok: true,
        contract_version: 3,
        operation_id: @operation_id,
        scope_fingerprint: @board_context.scope_fingerprint,
        issue_updates: [],
        created_issues: [],
        dependency_status_ids: @board_context.dependency_status_ids,
        deleted_issue_ids: [],
        evicted_issue_ids: [],
        tree_changes: [],
        invalidations: {
          issue_ids: [],
          parent_ids: [],
          column_counts: !!invalidations[:column_counts],
          root_order: !!invalidations[:root_order],
          board_snapshot: true
        },
        column_counts: {}
      }
    end
  end
end
