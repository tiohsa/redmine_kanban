require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))

class RedmineKanbanPriorityConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  def setup
    @issue_ids = []
    @project = projects(:projects_001)
    @user = users(:users_002)
    @tracker = @project.trackers.first || Tracker.first
    @open_status = IssueStatus.where(is_closed: false).first || IssueStatus.first
    @next_status = IssueStatus.where.not(id: @open_status.id).first || @open_status
    @original_priority, @new_priority = IssuePriority.active.limit(2).to_a
    skip 'Two active priorities are required for the concurrency test' unless @original_priority && @new_priority
  end

  def teardown
    Issue.where(id: @issue_ids).delete_all if @issue_ids.any?
  end

  def test_parent_priority_change_waits_for_child_update_and_wins_after_parent_lock_releases
    parent = create_issue('Parent', priority: @original_priority)
    child = create_issue('Child', parent_issue_id: parent.id, priority: @original_priority)
    parent_locked = Queue.new
    release_parent = Queue.new
    parent_update_finished = Queue.new

    child_update = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        Issue.transaction do
          locked_parent = Issue.find(parent.id)
          locked_parent.lock!
          expected_priority_id = locked_parent.priority_id
          child.reload.update!(status: @next_status)
          parent_locked << true
          release_parent.pop
          locked_parent.reload
          locked_parent.update_column(:priority_id, expected_priority_id)
        end
      end
    end

    parent_locked.pop
    parent_update = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        Issue.find(parent.id).update!(priority: @new_priority)
        parent_update_finished << true
      end
    end

    sleep 0.1
    assert parent_update_finished.empty?, 'parent priority update must wait for the child transaction lock'

    release_parent << true
    child_update.join
    parent_update.join

    assert_equal @new_priority.id, parent.reload.priority_id
  ensure
    release_parent << true if defined?(release_parent) && child_update&.alive?
    child_update&.join
    parent_update&.join
  end

  def test_post_commit_reconcile_does_not_overwrite_a_newer_priority_update
    issue = create_issue('Concurrent priority', priority: @original_priority)
    expected_lock_version = issue.lock_version

    issue.update!(priority: @new_priority)

    reconciler = Object.new.extend(RedmineKanban::PriorityPropagation)
    reconciler.send(:ensure_priority_applied!, issue.reload, @original_priority.id, expected_lock_version)

    assert_equal @new_priority.id, issue.reload.priority_id
  end

  private

  def create_issue(subject, parent_issue_id: nil, priority:)
    issue = Issue.create!(
      project: @project,
      tracker: @tracker,
      author: @user,
      status: @open_status,
      subject: subject,
      parent_issue_id: parent_issue_id,
      priority: priority,
    )
    @issue_ids << issue.id
    issue
  end
end
