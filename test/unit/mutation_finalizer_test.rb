require 'minitest/autorun'
require 'mocha/minitest'
require_relative '../../lib/redmine_kanban/mutation_finalizer'

class RedmineKanbanMutationFinalizerTest < Minitest::Test
  def setup
    @issue = stub(id: 42)
    @issue_payload = { id: 42, lock_version: 7, subtasks: [] }
    @context = mock('board context')
    @presenter = mock('issue presenter')
    @builder = mock('mutation result builder')
    RedmineKanban::MutationResultBuilder.expects(:new)
      .with(board_context: @context, operation_id: 'mutation-42').returns(@builder)
    @finalizer = RedmineKanban::MutationFinalizer.new(board_context: @context, operation_id: 'mutation-42')
    @delta = {
      ok: true, contract_version: 3, operation_id: 'mutation-42', scope_fingerprint: 'scope',
      issue_updates: [{ id: 42, lock_version: 7 }], created_issues: [], deleted_issue_ids: [],
      evicted_issue_ids: [99], tree_changes: [], dependency_status_ids: [1, 2],
      invalidations: { column_counts: true, board_snapshot: false }, column_counts: {}
    }
  end

  def test_preserves_delta_and_adds_issue_and_nonempty_ancestor_updates
    ancestors = [{ id: 10, done_ratio: 75, lock_version: 4 }]

    result = build_result(ancestors)

    assert_equal @delta.merge(issue: @issue_payload, ancestor_updates: ancestors), result
    refute @delta.key?(:issue)
    refute @delta.key?(:ancestor_updates)
  end

  def test_omits_nil_ancestor_updates
    assert_equal @delta.merge(issue: @issue_payload), build_result(nil)
  end

  def test_omits_empty_ancestor_updates
    assert_equal @delta.merge(issue: @issue_payload), build_result([])
  end

  def test_preserves_snapshot_fallback_while_adding_legacy_issue_and_ancestors
    @delta[:issue_updates] = []
    @delta[:evicted_issue_ids] = []
    @delta[:invalidations][:board_snapshot] = true
    ancestors = [{ id: 10, done_ratio: 100, lock_version: 5 }]

    assert_equal @delta.merge(issue: @issue_payload, ancestor_updates: ancestors), build_result(ancestors)
  end

  private

  def build_result(ancestor_updates)
    issue_updates = [@issue, stub(id: 10)]
    membership_recheck_ids = [42, 99]
    invalidations = { column_counts: true }
    order = sequence('response construction')
    @builder.expects(:build).with(
      issue_updates: issue_updates,
      membership_recheck_ids: membership_recheck_ids,
      invalidations: invalidations
    ).in_sequence(order).returns(@delta)
    @context.expects(:presenter).with([42]).in_sequence(order).returns([@presenter, nil])
    @presenter.expects(:issue_to_h).with(@issue).in_sequence(order).returns(@issue_payload)

    @finalizer.build(
      issue: @issue,
      issue_updates: issue_updates,
      membership_recheck_ids: membership_recheck_ids,
      ancestor_updates: ancestor_updates,
      invalidations: invalidations
    )
  end
end
