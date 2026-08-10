require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/snapshot_limits'

class RedmineKanbanSnapshotLimitsTest < ActiveSupport::TestCase
  def test_defaults_are_bounded
    assert_equal 1_500, RedmineKanban::SnapshotLimits.requested(nil)
    assert_equal 5_000, RedmineKanban::SnapshotLimits.server_entity_limit
    assert_equal 8 * 1024 * 1024, RedmineKanban::SnapshotLimits.response_bytes
    assert_equal 20, RedmineKanban::SnapshotLimits.query_limit
  end

  def test_requested_limit_accepts_only_positive_decimal_integers
    [1, '1', ' 1500 '].each { |value| assert_operator RedmineKanban::SnapshotLimits.requested(value), :>, 0 }
    ['0', '-1', '1.5', '1e5', 'NaN', 'Infinity', ''].each do |value|
      assert_raises(RedmineKanban::SnapshotLimits::InvalidLimit) { RedmineKanban::SnapshotLimits.requested(value) }
    end
  end

  def test_effective_limit_never_exceeds_server_limit
    previous = ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES']
    ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES'] = '5000'
    assert_equal 5_000, RedmineKanban::SnapshotLimits.effective(10_000)
  ensure
    ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES'] = previous
  end

  def test_invalid_environment_values_use_safe_defaults
    previous_entities = ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES']
    previous_bytes = ENV['REDMINE_KANBAN_MAX_RESPONSE_BYTES']
    previous_queries = ENV['REDMINE_KANBAN_MAX_BOARD_QUERIES']
    ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES'] = '0'
    ENV['REDMINE_KANBAN_MAX_RESPONSE_BYTES'] = '1e6'
    ENV['REDMINE_KANBAN_MAX_BOARD_QUERIES'] = '-1'

    assert_equal 5_000, RedmineKanban::SnapshotLimits.server_entity_limit
    assert_equal 8 * 1024 * 1024, RedmineKanban::SnapshotLimits.response_bytes
    assert_equal 20, RedmineKanban::SnapshotLimits.query_limit
  ensure
    ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES'] = previous_entities
    ENV['REDMINE_KANBAN_MAX_RESPONSE_BYTES'] = previous_bytes
    ENV['REDMINE_KANBAN_MAX_BOARD_QUERIES'] = previous_queries
  end
end
