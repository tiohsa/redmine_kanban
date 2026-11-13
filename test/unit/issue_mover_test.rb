require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/issue_mover'

class RedmineKanbanIssueMoverTest < ActiveSupport::TestCase
  fixtures :projects, :users, :roles, :members, :member_roles, :enabled_modules, :issues, :issue_statuses, :trackers,
           :projects_trackers, :enumerations

  def setup
    @previous_user = User.current
    @project = projects(:projects_001)
    @user = users(:users_002)
    User.current = @user
    @role = Role.find_by(name: 'Manager') || Role.givable.first || Role.first
    EnabledModule.find_or_create_by!(project_id: @project.id, name: 'redmine_kanban')
    grant_permissions!
    ensure_member!

    priorities = IssuePriority.active.order(:position).to_a
    skip 'Two active priorities are required for IssueMover tests' if priorities.size < 2

    @low_priority = priorities.first
    @high_priority = priorities.last
    @open_status = IssueStatus.where(is_closed: false).first || IssueStatus.first
  end

  def teardown
    User.current = @previous_user
    super
  end

  def test_move_child_same_status_new_priority_under_derived_priority_includes_visible_ancestors
    with_parent_issue_priority('derived') do
      grandparent = build_issue(subject: 'Grandparent', priority: @low_priority)
      parent = build_issue(subject: 'Parent', parent_issue_id: grandparent.id, priority: @low_priority)
      child = build_issue(subject: 'Child', parent_issue_id: parent.id, priority: @low_priority)

      result = mover(child).move(
        status_id: child.status_id,
        priority_id: @high_priority.id,
        priority_provided: true,
        lock_version: child.lock_version
      )

      assert_equal true, result[:ok], result.inspect
      assert_equal @high_priority.id, child.reload.priority_id
      assert_equal @high_priority.id, parent.reload.priority_id
      assert_equal @high_priority.id, grandparent.reload.priority_id

      issue_update_ids = result[:issue_updates].map { |item| item[:id] }
      assert_includes issue_update_ids, child.id
      assert_includes issue_update_ids, parent.id
      assert_includes issue_update_ids, grandparent.id

      parent_update = result[:issue_updates].find { |item| item[:id] == parent.id }
      grandparent_update = result[:issue_updates].find { |item| item[:id] == grandparent.id }
      assert_equal @high_priority.id, parent_update[:priority_id]
      assert_equal parent.lock_version, parent_update[:lock_version]
      assert_equal @high_priority.id, grandparent_update[:priority_id]
      assert_equal grandparent.lock_version, grandparent_update[:lock_version]

      ancestor_update_ids = result[:ancestor_updates].map { |item| item[:id] }
      assert_includes ancestor_update_ids, parent.id
      assert_includes ancestor_update_ids, grandparent.id
    end
  end

  def test_move_child_same_status_new_priority_excludes_non_visible_ancestors
    with_parent_issue_priority('derived') do
      other_author = users(:users_001)
      @role.remove_permission!(:view_private_issues) if @role.permissions.include?(:view_private_issues)
      @role.update!(issues_visibility: 'default')

      grandparent = build_issue(
        subject: 'Private Grandparent',
        priority: @low_priority,
        author: other_author,
        is_private: true
      )
      parent = build_issue(subject: 'Visible Parent', parent_issue_id: grandparent.id, priority: @low_priority)
      child = build_issue(subject: 'Visible Child', parent_issue_id: parent.id, priority: @low_priority)

      refute grandparent.visible?(@user), 'Expected private grandparent to not be visible to @user'
      assert parent.visible?(@user), 'Expected parent to be visible to @user'

      result = mover(child).move(
        status_id: child.status_id,
        priority_id: @high_priority.id,
        priority_provided: true,
        lock_version: child.lock_version
      )

      assert_equal true, result[:ok], result.inspect
      assert_equal @high_priority.id, parent.reload.priority_id

      issue_update_ids = result[:issue_updates].map { |item| item[:id] }
      assert_includes issue_update_ids, child.id
      assert_includes issue_update_ids, parent.id
      assert_not_includes issue_update_ids, grandparent.id

      ancestor_update_ids = result[:ancestor_updates].map { |item| item[:id] }
      assert_includes ancestor_update_ids, parent.id
      assert_not_includes ancestor_update_ids, grandparent.id
    end
  end

  def test_move_child_same_status_without_priority_change_does_not_include_ancestors
    with_parent_issue_priority('derived') do
      parent = build_issue(subject: 'Parent', priority: @low_priority)
      child = build_issue(subject: 'Child', parent_issue_id: parent.id, priority: @low_priority)
      parent.reload

      result = mover(child).move(
        status_id: child.status_id,
        assigned_to_id: @user.id,
        assigned_to_provided: true,
        priority_provided: false,
        lock_version: child.lock_version
      )

      assert_equal true, result[:ok], result.inspect
      assert_equal @low_priority.id, parent.reload.priority_id
      assert_nil result[:ancestor_updates]
      assert_equal [child.id], result[:issue_updates].map { |item| item[:id] }
    end
  end

  private

  def mover(issue)
    RedmineKanban::IssueMover.new(project: @project, issue: issue, user: @user)
  end

  def with_parent_issue_priority(mode)
    previous = Setting.parent_issue_priority
    Setting.parent_issue_priority = mode
    yield
  ensure
    Setting.parent_issue_priority = previous
  end

  def build_issue(subject:, priority:, parent_issue_id: nil, author: @user, is_private: false)
    issue = Issue.create!(
      project: @project,
      tracker: @project.trackers.first || Tracker.first,
      author: author,
      status: @open_status,
      subject: subject,
      parent_issue_id: parent_issue_id,
      priority: priority,
      is_private: is_private
    )
    Issue.find(issue.id)
  end

  def grant_permissions!
    %i[view_issues edit_issues view_redmine_kanban manage_redmine_kanban].each do |perm|
      @role.add_permission!(perm) unless @role.permissions.include?(perm)
    end
  end

  def ensure_member!
    member = Member.find_by(project_id: @project.id, user_id: @user.id) ||
             Member.create!(project: @project, user: @user, role_ids: [@role.id])
    MemberRole.create!(member_id: member.id, role_id: @role.id) unless member.roles.include?(@role)
  end
end
