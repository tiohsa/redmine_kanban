require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/board_data'

class RedmineKanbanBoardDataTest < ActiveSupport::TestCase
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
end
