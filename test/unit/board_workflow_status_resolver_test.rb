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
      blocked: create_issue('Workflow blocked', tracker, closed_status, priority, author: @user),
    }
    scenarios[:open_descendant] = create_issue('Workflow open descendant', tracker, open_status, priority, author: @user)
    scenarios[:closed_parent_reopen] = create_issue('Workflow closed parent reopen', tracker, closed_status, priority, author: @user)
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
