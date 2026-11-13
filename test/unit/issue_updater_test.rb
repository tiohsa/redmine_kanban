require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/issue_updater'

class RedmineKanbanIssueUpdaterTest < ActiveSupport::TestCase
  fixtures :projects, :users, :roles, :members, :member_roles, :enabled_modules, :issues, :issue_statuses, :trackers,
           :projects_trackers, :enumerations

  def setup
    @project = projects(:projects_001)
    @user = users(:users_002)
    @role = Role.find_by(name: 'Manager') || Role.givable.first || Role.first
    enable_kanban_module!
    grant_permissions!
    ensure_member!
  end

  def test_derived_parent_dates_include_reloaded_parent_and_grandparent
    previous_dates = Setting.parent_issue_dates
    Setting.parent_issue_dates = 'derived'

    grandparent = build_issue(subject: 'dates grandparent')
    parent = build_issue(subject: 'dates parent', parent_issue_id: grandparent.id)
    child = build_issue(subject: 'dates child', parent_issue_id: parent.id)

    new_start = Date.new(2026, 8, 10)
    new_due = Date.new(2026, 8, 20)

    result = issue_updater.update(
      issue_id: child.id,
      params: {
        start_date: new_start.iso8601,
        due_date: new_due.iso8601,
        lock_version: child.lock_version
      }
    )

    assert_equal true, result[:ok]

    reloaded_parent = parent.reload
    reloaded_grandparent = grandparent.reload
    assert_equal new_start, reloaded_parent.start_date
    assert_equal new_due, reloaded_parent.due_date
    assert_equal new_start, reloaded_grandparent.start_date
    assert_equal new_due, reloaded_grandparent.due_date

    update_by_id = result[:issue_updates].index_by { |item| item[:id] }
    assert_includes update_by_id.keys, child.id
    assert_includes update_by_id.keys, parent.id
    assert_includes update_by_id.keys, grandparent.id
    assert_equal new_start.iso8601, update_by_id[parent.id][:start_date]
    assert_equal new_due.iso8601, update_by_id[parent.id][:due_date]
    assert_equal reloaded_parent.lock_version, update_by_id[parent.id][:lock_version]
    assert_equal new_start.iso8601, update_by_id[grandparent.id][:start_date]
    assert_equal new_due.iso8601, update_by_id[grandparent.id][:due_date]
    assert_equal reloaded_grandparent.lock_version, update_by_id[grandparent.id][:lock_version]

    ancestor_ids = result[:ancestor_updates].map { |item| item[:id] }
    assert_includes ancestor_ids, parent.id
    assert_includes ancestor_ids, grandparent.id
  ensure
    Setting.parent_issue_dates = previous_dates
  end

  def test_derived_parent_priority_includes_reloaded_parent_and_grandparent
    previous_priority = Setting.parent_issue_priority
    Setting.parent_issue_priority = 'derived'

    priorities = IssuePriority.active.order(:position).to_a
    skip 'Need at least 2 active priorities' if priorities.size < 2
    low_priority = priorities.first
    high_priority = priorities.last

    grandparent = build_issue(subject: 'priority grandparent', priority: low_priority)
    parent = build_issue(subject: 'priority parent', parent_issue_id: grandparent.id, priority: low_priority)
    child = build_issue(subject: 'priority child', parent_issue_id: parent.id, priority: low_priority)

    result = issue_updater.update(
      issue_id: child.id,
      params: {
        priority_id: high_priority.id,
        lock_version: child.lock_version
      }
    )

    assert_equal true, result[:ok]

    reloaded_parent = parent.reload
    reloaded_grandparent = grandparent.reload
    assert_equal high_priority.id, reloaded_parent.priority_id
    assert_equal high_priority.id, reloaded_grandparent.priority_id

    update_by_id = result[:issue_updates].index_by { |item| item[:id] }
    assert_includes update_by_id.keys, child.id
    assert_includes update_by_id.keys, parent.id
    assert_includes update_by_id.keys, grandparent.id
    assert_equal high_priority.id, update_by_id[parent.id][:priority_id]
    assert_equal reloaded_parent.lock_version, update_by_id[parent.id][:lock_version]
    assert_equal high_priority.id, update_by_id[grandparent.id][:priority_id]
    assert_equal reloaded_grandparent.lock_version, update_by_id[grandparent.id][:lock_version]

    ancestor_ids = result[:ancestor_updates].map { |item| item[:id] }
    assert_includes ancestor_ids, parent.id
    assert_includes ancestor_ids, grandparent.id
  ensure
    Setting.parent_issue_priority = previous_priority
  end

  def test_non_visible_ancestors_are_excluded
    previous_dates = Setting.parent_issue_dates
    previous_visibility = @role.issues_visibility
    Setting.parent_issue_dates = 'derived'
    @role.update!(issues_visibility: 'default')

    other_user = users(:users_001)
    grandparent = build_issue(subject: 'private grandparent', author: other_user, is_private: true)
    parent = build_issue(subject: 'visible parent', parent_issue_id: grandparent.id)
    child = build_issue(subject: 'visible child', parent_issue_id: parent.id)

    refute grandparent.visible?(@user)
    assert parent.visible?(@user)

    result = issue_updater.update(
      issue_id: child.id,
      params: {
        due_date: Date.new(2026, 9, 15).iso8601,
        lock_version: child.lock_version
      }
    )

    assert_equal true, result[:ok]

    update_ids = result[:issue_updates].map { |item| item[:id] }
    assert_includes update_ids, child.id
    assert_includes update_ids, parent.id
    refute_includes update_ids, grandparent.id

    ancestor_ids = result[:ancestor_updates].map { |item| item[:id] }
    assert_includes ancestor_ids, parent.id
    refute_includes ancestor_ids, grandparent.id
  ensure
    @role.update!(issues_visibility: previous_visibility) if defined?(previous_visibility) && previous_visibility
    Setting.parent_issue_dates = previous_dates
  end

  def test_active_filter_invalidation_when_parent_affecting_attributes_change
    previous_dates = Setting.parent_issue_dates
    previous_priority = Setting.parent_issue_priority
    Setting.parent_issue_dates = 'derived'
    Setting.parent_issue_priority = 'derived'

    priorities = IssuePriority.active.order(:position).to_a
    skip 'Need at least 2 active priorities' if priorities.size < 2
    low_priority = priorities.first
    high_priority = priorities.last

    parent = build_issue(subject: 'filtered parent', priority: low_priority)
    child = build_issue(subject: 'filtered child', parent_issue_id: parent.id, priority: low_priority)

    due_filter = RedmineKanban::BoardIssueFilter.new(due: '7days', date_anchor: '2026-08-01')
    due_result = issue_updater(issue_filter: due_filter).update(
      issue_id: child.id,
      params: {
        due_date: '2026-08-05',
        lock_version: child.lock_version
      }
    )

    assert_equal true, due_result[:ok]
    assert_equal true, due_result.dig(:invalidations, :board_snapshot)

    priority_filter = RedmineKanban::BoardIssueFilter.new(priority_filter_enabled: true, priority_ids: [high_priority.id])
    priority_result = issue_updater(issue_filter: priority_filter).update(
      issue_id: child.reload.id,
      params: {
        priority_id: high_priority.id,
        lock_version: child.lock_version
      }
    )

    assert_equal true, priority_result[:ok]
    assert_equal true, priority_result.dig(:invalidations, :board_snapshot)
  ensure
    Setting.parent_issue_dates = previous_dates
    Setting.parent_issue_priority = previous_priority
  end

  private

  def issue_updater(issue_filter: nil)
    context = RedmineKanban::BoardContext.new(project: @project, user: @user, issue_filter: issue_filter)
    RedmineKanban::IssueUpdater.new(project: @project, user: @user, board_context: context)
  end

  def build_issue(subject:, parent_issue_id: nil, priority: nil, author: @user, is_private: false)
    Issue.new(
      project: @project,
      tracker: @project.trackers.first,
      author: author,
      status: IssueStatus.first,
      priority: priority || IssuePriority.active.first,
      subject: subject,
      parent_issue_id: parent_issue_id,
      is_private: is_private
    ).tap(&:save!)
  end

  def enable_kanban_module!
    EnabledModule.find_or_create_by!(project_id: @project.id, name: 'redmine_kanban')
  end

  def grant_permissions!
    @role.add_permission!(:view_redmine_kanban) unless @role.permissions.include?(:view_redmine_kanban)
    @role.add_permission!(:manage_redmine_kanban) unless @role.permissions.include?(:manage_redmine_kanban)
    @role.add_permission!(:view_issues) unless @role.permissions.include?(:view_issues)
    @role.add_permission!(:add_issues) unless @role.permissions.include?(:add_issues)
    @role.add_permission!(:edit_issues) unless @role.permissions.include?(:edit_issues)
    @role.add_permission!(:manage_subtasks) unless @role.permissions.include?(:manage_subtasks)
  end

  def ensure_member!
    member = Member.find_by(project_id: @project.id, user_id: @user.id) || Member.create!(project: @project, user: @user, role_ids: [@role.id])
    MemberRole.create!(member_id: member.id, role_id: @role.id) unless member.roles.include?(@role)
  end
end
