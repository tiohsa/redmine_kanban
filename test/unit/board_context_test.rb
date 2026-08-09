require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/board_context'

class RedmineKanbanBoardContextTest < ActiveSupport::TestCase
  fixtures :projects, :users, :issue_statuses, :members, :member_roles, :roles

  def setup
    @project = projects(:projects_001)
    @user = users(:users_002)
  end

  def test_nil_scope_uses_default_status_scope
    context = RedmineKanban::BoardContext.new(project: @project, user: @user, scope_status_ids: nil)
    assert_equal IssueStatus.sorted.pluck(:id), context.scope_status_ids
  end

  def test_explicit_scope_keeps_only_requested_statuses
    statuses = IssueStatus.sorted.limit(2).pluck(:id)
    context = RedmineKanban::BoardContext.new(project: @project, user: @user, scope_status_ids: statuses)
    assert_equal statuses, context.scope_status_ids
  end

  def test_explicit_empty_scope_stays_empty
    context = RedmineKanban::BoardContext.new(project: @project, user: @user, scope_status_ids: [])
    assert_equal [], context.scope_status_ids
  end
end
