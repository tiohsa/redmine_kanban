require File.expand_path('../../../../test/test_helper', __FILE__)
require_relative '../../lib/redmine_kanban/settings'

class RedmineKanbanSettingsTest < ActiveSupport::TestCase
  def test_defaults_and_normalization
    s = RedmineKanban::Settings.new({})
    assert_equal 'assignee', s.lane_type
    assert_equal 'column', s.wip_limit_mode
    assert_equal 'block', s.wip_exceed_behavior
    assert_equal 500, s.issue_limit
    assert_equal 3, s.aging_warn_days
    assert_equal 7, s.aging_danger_days
  end

  def test_invalid_values_fallback
    s = RedmineKanban::Settings.new(
      'lane_type' => 'unknown',
      'wip_limit_mode' => 'x',
      'wip_exceed_behavior' => 'y',
      'issue_limit' => '0',
      'aging_warn_days' => '-1',
      'aging_danger_days' => '0'
    )

    assert_equal 'assignee', s.lane_type
    assert_equal 'column', s.wip_limit_mode
    assert_equal 'block', s.wip_exceed_behavior
    assert_equal 1, s.issue_limit
    assert_equal 0, s.aging_warn_days
    assert_equal 0, s.aging_danger_days
  end

  def test_wip_limits_hash_normalization
    s = RedmineKanban::Settings.new('wip_limits' => { '1' => '2', 3 => '4' })
    assert_equal({ 1 => 2, 3 => 4 }, s.wip_limits)
  end

  def test_hidden_status_ids_normalization
    s = RedmineKanban::Settings.new('hidden_status_ids' => %w[1 1 2])
    assert_equal [1, 2], s.hidden_status_ids
  end
end
