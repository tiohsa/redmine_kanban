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
    skip 'fixture project has no issue' if @issues.empty?

    resolver = RedmineKanban::BoardWorkflowStatusResolver.new(user: @user, issues: @issues)
    @issues.each do |issue|
      expected = ([issue.status] + issue.new_statuses_allowed_to(@user)).compact.map(&:id).uniq.sort
      actual = ([issue.status] + resolver.call(issue)).compact.map(&:id).uniq.sort
      assert_equal expected, actual, "workflow mismatch for issue ##{issue.id}"
    end
  end
end
