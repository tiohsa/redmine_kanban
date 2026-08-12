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

  def test_dependency_scope_preserves_explicit_statuses_when_primary_scope_is_narrower
    statuses = IssueStatus.sorted.pluck(:id)
    context = RedmineKanban::BoardContext.new(
      project: @project,
      user: @user,
      scope_status_ids: [statuses.first],
      dependency_status_ids: statuses
    )

    assert_equal [statuses.first], context.scope_status_ids
    assert_equal statuses, context.dependency_status_ids
  end

  def test_dependency_scope_includes_explicit_primary_scope
    statuses = IssueStatus.sorted.limit(2).pluck(:id)
    context = RedmineKanban::BoardContext.new(
      project: @project,
      user: @user,
      scope_status_ids: [statuses.first],
      dependency_status_ids: [statuses.last]
    )

    assert_equal [statuses.first], context.scope_status_ids
    assert_equal statuses.sort, context.dependency_status_ids.sort
  end

  def test_scope_fingerprint_includes_board_and_status_scopes_but_normalizes_order
    statuses = IssueStatus.sorted.limit(3).pluck(:id)
    first = RedmineKanban::BoardContext.new(
      project: @project,
      user: @user,
      project_ids: [@project.id, @project.id],
      scope_status_ids: statuses.first(2),
      dependency_status_ids: statuses
    )
    reordered = RedmineKanban::BoardContext.new(
      project: @project,
      user: @user,
      project_ids: [@project.id],
      scope_status_ids: statuses.first(2).reverse,
      dependency_status_ids: statuses.reverse
    )
    different_primary_scope = RedmineKanban::BoardContext.new(
      project: @project,
      user: @user,
      project_ids: [@project.id],
      scope_status_ids: [statuses.first],
      dependency_status_ids: statuses
    )
    different_dependency_scope = RedmineKanban::BoardContext.new(
      project: @project,
      user: @user,
      project_ids: [@project.id],
      scope_status_ids: statuses.first(2),
      dependency_status_ids: statuses.first(2)
    )

    assert_equal first.scope_fingerprint, reordered.scope_fingerprint
    refute_equal first.scope_fingerprint, different_primary_scope.scope_fingerprint
    refute_equal first.scope_fingerprint, different_dependency_scope.scope_fingerprint
  end
end
