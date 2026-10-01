require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/snapshot_limits'

class RedmineKanbanSnapshotLimitsTest < ActiveSupport::TestCase
  def test_defaults_are_bounded
    assert_equal 1_500, RedmineKanban::SnapshotLimits.requested(nil)
    assert_equal 5_000, RedmineKanban::SnapshotLimits.server_entity_limit
    assert_equal 8 * 1024 * 1024, RedmineKanban::SnapshotLimits.response_bytes
    assert_equal 20, RedmineKanban::SnapshotLimits.query_limit
    assert_equal 100, RedmineKanban::SnapshotLimits.total_query_limit
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
    previous_total_queries = ENV['REDMINE_KANBAN_MAX_TOTAL_BOARD_QUERIES']
    ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES'] = '-1'
    ENV['REDMINE_KANBAN_MAX_RESPONSE_BYTES'] = '1e6'
    ENV['REDMINE_KANBAN_MAX_BOARD_QUERIES'] = '-1'
    ENV['REDMINE_KANBAN_MAX_TOTAL_BOARD_QUERIES'] = '0'

    assert_equal 5_000, RedmineKanban::SnapshotLimits.server_entity_limit
    assert_equal 8 * 1024 * 1024, RedmineKanban::SnapshotLimits.response_bytes
    assert_equal 20, RedmineKanban::SnapshotLimits.query_limit
    assert_equal 100, RedmineKanban::SnapshotLimits.total_query_limit
  ensure
    ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES'] = previous_entities
    ENV['REDMINE_KANBAN_MAX_RESPONSE_BYTES'] = previous_bytes
    ENV['REDMINE_KANBAN_MAX_BOARD_QUERIES'] = previous_queries
    ENV['REDMINE_KANBAN_MAX_TOTAL_BOARD_QUERIES'] = previous_total_queries
  end

  def test_only_explicit_zero_disables_the_server_count_limit
    previous = ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES']
    { nil => 5_000, '' => 5_000, '  ' => 5_000, '5000' => 5_000, '250' => 250,
      '0' => nil, ' 0 ' => nil, '-1' => 5_000, '00' => 5_000,
      '1e5' => 5_000, 'Infinity' => 5_000, '2147483648' => 5_000 }.each do |value, expected|
      ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES'] = value
      actual = RedmineKanban::SnapshotLimits.server_entity_limit
      if expected.nil?
        assert_nil actual, value.inspect
      else
        assert_equal expected, actual, value.inspect
      end
    end
  ensure
    ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES'] = previous
  end

  def test_disabled_server_count_limit_keeps_the_requested_limit_and_reconciliation_batch_limit
    previous = ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES']
    ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES'] = '0'

    assert_nil RedmineKanban::SnapshotLimits.server_entity_limit
    assert_equal 10_000, RedmineKanban::SnapshotLimits.effective(10_000)
    assert_equal 1_500, RedmineKanban::SnapshotLimits.effective(RedmineKanban::SnapshotLimits.requested(nil))
    assert_equal 100, RedmineKanban::SnapshotLimits.entity_reconciliation_limit
    assert_raises(RedmineKanban::SnapshotLimits::InvalidLimit) { RedmineKanban::SnapshotLimits.requested('0') }
  ensure
    ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES'] = previous
  end
end
