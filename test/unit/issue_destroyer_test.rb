require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/issue_destroyer'

class RedmineKanbanIssueDestroyerTest < ActiveSupport::TestCase
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
  end

  def teardown
    User.current = @previous_user
    super
  end

  def test_destroy_returns_cascade_tombstones
    parent = build_issue(subject: 'Destroyer parent')
    child = build_issue(subject: 'Destroyer child', parent_issue_id: parent.id)
    parent.reload

    result = destroyer(parent).destroy(lock_version: parent.lock_version)

    assert_equal true, result[:ok], result.inspect
    assert_equal [parent.id, child.id].sort, result[:deleted_issue_ids].sort
    assert_nil Issue.find_by(id: parent.id)
    assert_nil Issue.find_by(id: child.id)
  end

  def test_destroy_requires_lock_version_without_deleting_issue
    issue = build_issue(subject: 'Destroyer missing lock')

    result = destroyer(issue).destroy(lock_version: nil)

    assert_equal({ ok: false, message: I18n.t('redmine_kanban.error_lock_version_required') }, result)
    assert Issue.exists?(issue.id)
  end

  def test_destroy_rejects_stale_lock_version_without_deleting_issue
    issue = build_issue(subject: 'Destroyer stale lock')

    result = destroyer(issue).destroy(lock_version: issue.lock_version + 1)

    assert_equal({ ok: false, message: I18n.t('redmine_kanban.error_conflict') }, result)
    assert Issue.exists?(issue.id)
  end

  def test_destroy_rechecks_permission_inside_service
    issue = build_issue(subject: 'Destroyer forbidden')
    RedmineKanban::PermissionPolicy.any_instance.stubs(:can_delete_issue?).returns(false)

    result = destroyer(issue).destroy(lock_version: issue.lock_version)

    assert_equal({ ok: false, message: I18n.t('redmine_kanban.error_permission_denied') }, result)
    assert Issue.exists?(issue.id)
  end

  private

  def destroyer(issue)
    RedmineKanban::IssueDestroyer.new(project: @project, issue: issue, user: @user)
  end

  def build_issue(subject:, parent_issue_id: nil)
    issue = Issue.create!(
      project: @project,
      tracker: @project.trackers.first || Tracker.first,
      author: @user,
      status: IssueStatus.first,
      subject: subject,
      parent_issue_id: parent_issue_id,
      priority: IssuePriority.active.first
    )
    Issue.find(issue.id)
  end

  def grant_permissions!
    @role.add_permission!(:view_redmine_kanban) unless @role.permissions.include?(:view_redmine_kanban)
    @role.add_permission!(:manage_redmine_kanban) unless @role.permissions.include?(:manage_redmine_kanban)
    @role.add_permission!(:delete_issues) unless @role.permissions.include?(:delete_issues)
  end

  def ensure_member!
    member = Member.find_by(project_id: @project.id, user_id: @user.id) || Member.create!(project: @project, user: @user, role_ids: [@role.id])
    MemberRole.create!(member_id: member.id, role_id: @role.id) unless member.roles.include?(@role)
  end
end
