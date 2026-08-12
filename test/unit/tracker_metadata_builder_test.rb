require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/tracker_metadata_builder'

class RedmineKanbanTrackerMetadataBuilderTest < ActiveSupport::TestCase
  fixtures :projects, :trackers, :issue_statuses, :workflows, :projects_trackers

  def setup
    @project = projects(:projects_001)
    @tracker = @project.trackers.first || Tracker.first
  end

  def test_build_adds_workflow_default_and_project_metadata
    metadata = RedmineKanban::TrackerMetadataBuilder.new(
      trackers: [@tracker],
      available_project_ids_by_tracker: { @tracker.id => [@project.id] }
    ).build.first

    assert_equal @tracker.id, metadata[:id]
    assert_equal @tracker.name, metadata[:name]
    assert_equal [@project.id], metadata[:available_project_ids]
    assert metadata.key?(:workflow_status_ids)
    assert metadata.key?(:default_status_id)
  end

  def test_build_deduplicates_transition_statuses_and_ignores_invalid_statuses
    metadata = RedmineKanban::TrackerMetadataBuilder.new(
      trackers: [@tracker],
      available_project_ids_by_tracker: { @tracker.id => [@project.id] }
    ).build.first

    assert_equal metadata[:workflow_status_ids].uniq, metadata[:workflow_status_ids]
    assert metadata[:workflow_status_ids].all? { |id| id.to_i.positive? && IssueStatus.exists?(id: id) }
  end

  def test_workflow_status_ids_match_redmine_core_tracker_issue_statuses
    metadata = RedmineKanban::TrackerMetadataBuilder.new(
      trackers: [@tracker],
      available_project_ids_by_tracker: { @tracker.id => [@project.id] }
    ).build.first

    assert_equal @tracker.issue_statuses.map(&:id).sort, metadata[:workflow_status_ids].sort
  end

  def test_build_uses_a_constant_number_of_metadata_queries_for_multiple_trackers
    trackers = Tracker.all.to_a
    skip 'requires at least two trackers' if trackers.length < 2

    queries = []
    subscriber = ActiveSupport::Notifications.subscribe('sql.active_record') do |_name, _start, _finish, _id, payload|
      queries << payload[:sql] unless payload[:name] == 'SCHEMA'
    end

    RedmineKanban::TrackerMetadataBuilder.new(
      trackers: trackers,
      available_project_ids_by_tracker: trackers.to_h { |tracker| [tracker.id, [@project.id]] }
    ).build
  ensure
    ActiveSupport::Notifications.unsubscribe(subscriber) if subscriber
    if queries
      metadata_queries = queries.count { |sql| sql.match?(/workflows|issue_statuses/i) }
      assert_operator metadata_queries, :<=, 2
    end
  end
end
