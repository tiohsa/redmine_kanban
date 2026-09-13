require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/board_labels'

class RedmineKanbanBoardLabelsTest < ActiveSupport::TestCase
  def test_labels_builds_values_from_translation_key_map
    RedmineKanban::BoardLabels::TRANSLATION_KEYS.each_value do |translation_key|
      I18n.stubs(:t).with(translation_key).returns("translated:#{translation_key}")
    end
    labels = build_labels

    expected_keys = RedmineKanban::BoardLabels::TRANSLATION_KEYS.keys
    assert_equal expected_keys, labels.keys

    RedmineKanban::BoardLabels::TRANSLATION_KEYS.each do |label_key, translation_key|
      assert_equal "translated:#{translation_key}", labels[label_key]
    end
  end

  def test_each_build_uses_the_current_locale_without_memoizing_translations
    english = I18n.with_locale(:en) { build_labels }
    japanese = I18n.with_locale(:ja) { build_labels }

    assert_equal I18n.t('redmine_kanban.label_all', locale: :en), english[:all]
    assert_equal I18n.t('redmine_kanban.label_all', locale: :ja), japanese[:all]
    refute_equal english[:all], japanese[:all]
    assert_equal english, I18n.with_locale(:en) { build_labels }
  end

  private

  def build_labels
    RedmineKanban::BoardLabels.build
  end
end
