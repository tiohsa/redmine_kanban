require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/board_tree_builder'

class RedmineKanbanBoardTreeBuilderTest < ActiveSupport::TestCase
  FakeTreeIssue = Struct.new(:id, :parent_id, :updated_on)

  def test_empty_snapshot
    assert_equal({ root_ids: [], children_by_parent_id: {} }, build_tree([]))
  end

  def test_roots_preserve_input_order_and_remove_duplicates
    issues = [
      FakeTreeIssue.new(8, nil, Time.at(1)),
      FakeTreeIssue.new(3, nil, Time.at(20)),
      FakeTreeIssue.new(8, nil, Time.at(30))
    ]

    assert_equal({ root_ids: [8, 3], children_by_parent_id: {} }, build_tree(issues))
  end

  def test_missing_blank_and_self_parents_become_roots
    issues = [
      FakeTreeIssue.new(5, 99, nil),
      FakeTreeIssue.new(4, 4, nil),
      FakeTreeIssue.new(3, '', nil),
      FakeTreeIssue.new(2, nil, nil),
      FakeTreeIssue.new(1, '2', nil)
    ]

    assert_equal({ root_ids: [5, 4, 3, 2], children_by_parent_id: { '2' => [1] } }, build_tree(issues))
  end

  def test_children_sort_by_descending_timestamp_then_ascending_id
    issues = [
      FakeTreeIssue.new(1, nil, nil),
      FakeTreeIssue.new(6, 1, nil),
      FakeTreeIssue.new(5, 1, Time.at(20.9)),
      FakeTreeIssue.new(4, 1, Time.at(20.1)),
      FakeTreeIssue.new(3, 1, Time.at(30)),
      FakeTreeIssue.new(2, 1, Time.at(0))
    ]

    assert_equal [3, 4, 5, 2, 6], build_tree(issues)[:children_by_parent_id]['1']
  end

  def test_cycle_is_cut_at_the_first_encountered_child_and_keeps_empty_parent_entries
    issues = [
      FakeTreeIssue.new(3, 2, nil),
      FakeTreeIssue.new(2, 1, nil),
      FakeTreeIssue.new(1, 3, nil),
      FakeTreeIssue.new(9, nil, nil)
    ]

    assert_equal({ root_ids: [9, 3], children_by_parent_id: { '2' => [], '1' => [2], '3' => [1] } }, build_tree(issues))
  end

  def test_a_branch_entering_a_cycle_and_disconnected_cycles_are_handled_in_input_order
    issues = [
      FakeTreeIssue.new(4, 1, nil),
      FakeTreeIssue.new(1, 2, nil),
      FakeTreeIssue.new(2, 1, nil),
      FakeTreeIssue.new(6, 7, nil),
      FakeTreeIssue.new(7, 6, nil)
    ]

    assert_equal({ root_ids: [4, 1, 6], children_by_parent_id: { '1' => [2], '2' => [], '7' => [], '6' => [7] } }, build_tree(issues))
  end

  def test_duplicate_child_input_keeps_existing_multiplicity_and_uses_the_last_timestamp
    issues = [
      FakeTreeIssue.new(1, nil, nil),
      FakeTreeIssue.new(2, 1, Time.at(30)),
      FakeTreeIssue.new(3, 1, Time.at(20)),
      FakeTreeIssue.new(2, 1, Time.at(10))
    ]

    assert_equal({ root_ids: [1], children_by_parent_id: { '1' => [3, 2, 2] } }, build_tree(issues))
  end

  def test_build_does_not_mutate_the_snapshot
    issues = [FakeTreeIssue.new(2, 1, Time.at(2)).freeze, FakeTreeIssue.new(1, nil, nil).freeze].freeze

    assert_equal({ root_ids: [1], children_by_parent_id: { '1' => [2] } }, build_tree(issues))
    assert_equal [2, 1], issues.map(&:id)
    assert_equal [1, nil], issues.map(&:parent_id)
  end

  def test_build_tree_handles_a_deep_chain_iteratively
    issues = (1..1_500).map do |id|
      FakeTreeIssue.new(id, id == 1 ? nil : id - 1, Time.at(id))
    end

    tree = build_tree(issues)

    assert_equal [1], tree[:root_ids]
    assert_equal [2], tree[:children_by_parent_id]["1"]
    assert_equal [1_500], tree[:children_by_parent_id]["1499"]
  end

  def test_build_tree_bounds_a_high_fan_out_snapshot_to_unique_children
    parent = FakeTreeIssue.new(1, nil, Time.at(1))
    children = (2..1_500).map { |id| FakeTreeIssue.new(id, 1, Time.at(id)) }

    tree = build_tree([parent, *children])

    assert_equal [1], tree[:root_ids]
    assert_equal 1_499, tree[:children_by_parent_id]["1"].size
    assert_equal (2..1_500).to_a.reverse, tree[:children_by_parent_id]["1"]
  end

  private

  def build_tree(issues)
    RedmineKanban::BoardTreeBuilder.new(issues).build
  end
end
