require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/board_data'

class RedmineKanbanBoardDataTest < ActiveSupport::TestCase
  FakeTreeIssue = Struct.new(:id, :parent_id, :updated_on)

  def test_labels_builds_values_from_translation_key_map
    board_data = RedmineKanban::BoardData.allocate

    RedmineKanban::BoardData::LABEL_TRANSLATION_KEYS.each_value do |translation_key|
      I18n.stubs(:t).with(translation_key).returns("translated:#{translation_key}")
    end
    labels = board_data.send(:labels)

    expected_keys = RedmineKanban::BoardData::LABEL_TRANSLATION_KEYS.keys
    assert_equal expected_keys, labels.keys

    RedmineKanban::BoardData::LABEL_TRANSLATION_KEYS.each do |label_key, translation_key|
      assert_equal "translated:#{translation_key}", labels[label_key]
    end
  end

  def test_build_tree_handles_a_deep_chain_iteratively
    board_data = RedmineKanban::BoardData.allocate
    issues = (1..1_500).map do |id|
      FakeTreeIssue.new(id, id == 1 ? nil : id - 1, Time.at(id))
    end

    tree = board_data.send(:build_tree, issues)

    assert_equal [1], tree[:root_ids]
    assert_equal [2], tree[:children_by_parent_id]["1"]
    assert_equal [1_500], tree[:children_by_parent_id]["1499"]
  end

  def test_build_tree_bounds_a_high_fan_out_snapshot_to_unique_children
    board_data = RedmineKanban::BoardData.allocate
    parent = FakeTreeIssue.new(1, nil, Time.at(1))
    children = (2..1_500).map { |id| FakeTreeIssue.new(id, 1, Time.at(id)) }

    tree = board_data.send(:build_tree, [parent, *children])

    assert_equal [1], tree[:root_ids]
    assert_equal 1_499, tree[:children_by_parent_id]["1"].size
    assert_equal (2..1_500).to_a.reverse, tree[:children_by_parent_id]["1"]
  end
end
