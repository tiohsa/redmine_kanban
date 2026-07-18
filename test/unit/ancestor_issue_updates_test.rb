require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))

require_relative '../../lib/redmine_kanban/ancestor_issue_updates'
require_relative '../../lib/redmine_kanban/board_issue_presenter'

class RedmineKanbanAncestorIssueUpdatesTest < ActiveSupport::TestCase
  FakeAncestor = Struct.new(
    :id,
    :done_ratio,
    :lock_version,
    :updated_on,
    :aging_days,
    :visible,
    :reload_count,
    keyword_init: true
  ) do
    def visible?(_user)
      visible
    end

    def reload
      self.reload_count = reload_count.to_i + 1
      self
    end
  end

  FakeIssue = Struct.new(:ancestors)

  class Harness
    include RedmineKanban::AncestorIssueUpdates

    def initialize(user)
      @user = user
    end

    def call(issue)
      ancestor_updates_for(issue)
    end
  end

  def test_returns_reloaded_progress_for_visible_ancestors
    visible = FakeAncestor.new(
      id: 10,
      done_ratio: 75,
      lock_version: 4,
      updated_on: Time.utc(2026, 7, 18, 1, 2, 3),
      aging_days: 0,
      visible: true
    )
    hidden = FakeAncestor.new(
      id: 5,
      done_ratio: 100,
      lock_version: 9,
      updated_on: Time.utc(2026, 7, 18, 1, 2, 4),
      visible: false
    )

    result = Harness.new(Object.new).call(FakeIssue.new([visible, hidden]))

    assert_equal 1, result.length
    assert_equal 10, result.first[:id]
    assert_equal 75, result.first[:done_ratio]
    assert_equal 4, result.first[:lock_version]
    assert_equal '2026-07-18T01:02:03Z', result.first[:updated_on]
    assert_equal 0, result.first[:aging_days]
    assert_equal 1, visible.reload_count
    assert_nil hidden.reload_count
  end
end
