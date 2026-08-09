require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/board_workflow_status_resolver'

class RedmineKanbanBoardWorkflowStatusResolverTest < ActiveSupport::TestCase
  fixtures :projects, :users, :roles, :members, :member_roles, :issues, :issue_statuses, :trackers,
           :workflows

  def setup
    @user = users(:users_002)
    @project = projects(:projects_001)
    @issues = Issue.where(project_id: @project.id).order(:id).to_a
  end

  def test_resolver_matches_redmine_core_for_fixture_issue_conditions
    scenarios = workflow_scenarios
    skip 'fixture project has no issue' if scenarios.empty?

    resolver = RedmineKanban::BoardWorkflowStatusResolver.new(user: @user, issues: scenarios.values)
    scenarios.each do |name, issue|
      expected = ([issue.status] + issue.new_statuses_allowed_to(@user)).compact.map(&:id).uniq.sort
      actual = ([issue.status] + resolver.call(issue)).compact.map(&:id).uniq.sort
      assert_equal expected, actual, "workflow mismatch for #{name} issue ##{issue.id}"
    end
  end

  private

  def workflow_scenarios
    return {} if @issues.empty?

    tracker = @issues.first.tracker
    priority = @issues.first.priority
    open_status = IssueStatus.where(is_closed: false).first || @issues.first.status
    closed_status = IssueStatus.where(is_closed: true).first || open_status
    other_user = users(:users_001)
    ensure_member(other_user)

    scenarios = {
      normal: @issues.first,
      author_only: create_issue('Workflow author only', tracker, open_status, priority, author: @user),
      assignee_only: create_issue('Workflow assignee only', tracker, open_status, priority, author: other_user, assigned_to: @user),
      author_and_assignee: create_issue('Workflow author and assignee', tracker, open_status, priority, author: @user, assigned_to: @user),
    }
    blocker = create_issue('Workflow blocker', tracker, open_status, priority, author: other_user)
    blocked = create_issue('Workflow blocked', tracker, open_status, priority, author: @user)
    IssueRelation.create!(issue_from: blocker, issue_to: blocked, relation_type: 'blocks')
    assert blocked.blocked?
    scenarios[:blocked] = blocked

    open_descendant_parent = create_issue('Workflow open descendant parent', tracker, open_status, priority, author: @user)
    open_descendant = create_issue('Workflow open descendant', tracker, open_status, priority, author: @user, parent_issue_id: open_descendant_parent.id)
    open_descendant_parent.reload
    assert_equal open_descendant_parent.id, open_descendant.parent_id
    refute open_descendant.closed?
    scenarios[:open_descendant] = open_descendant_parent

    closed_parent = create_issue('Workflow closed parent', tracker, closed_status, priority, author: @user)
    closed_parent_child = create_issue('Workflow closed parent child', tracker, closed_status, priority, author: @user, parent_issue_id: closed_parent.id)
    closed_parent.reload
    assert_equal closed_parent.id, closed_parent_child.parent_id
    assert closed_parent.closed?
    scenarios[:closed_parent_reopen] = closed_parent_child

    open_parent = create_issue('Workflow open parent', tracker, open_status, priority, author: @user)
    open_parent_child = create_issue('Workflow open parent child', tracker, closed_status, priority, author: @user, parent_issue_id: open_parent.id)
    open_parent.reload
    assert_equal open_parent.id, open_parent_child.parent_id
    refute open_parent.closed?
    assert open_parent_child.closed?
    scenarios[:open_parent_negative] = open_parent_child
    scenarios
  end

  def ensure_member(user)
    role = Role.givable.first || Role.first
    member = Member.find_by(project: @project, user: user)
    member ||= Member.create!(project: @project, user: user, role_ids: [role.id])
    MemberRole.find_or_create_by!(member: member, role: role)
  end

  def create_issue(subject, tracker, status, priority, author:, assigned_to: nil, parent_issue_id: nil)
    issue = Issue.new(
      project: @project,
      tracker: tracker,
      status: status,
      priority: priority,
      author: author,
      assigned_to: assigned_to,
      parent_issue_id: parent_issue_id,
      subject: subject
    )
    issue.save!
    issue.reload
  end
end
