require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require 'set'

require_relative '../../lib/redmine_kanban/board_issue_presenter'
include ActiveSupport::Testing::TimeHelpers

class RedmineKanbanBoardIssuePresenterTest < ActiveSupport::TestCase
  FakeProject = Struct.new(:id, :name)
  FakeStatus = Struct.new(:id, :is_closed) do
    def is_closed?
      is_closed
    end
  end

  FakeIssue = Struct.new(
    :id,
    :parent_id,
    :subject,
    :status_id,
    :tracker_id,
    :status,
    :lock_version,
    :project,
    :assigned_to_id,
    :due_date,
    :priority_id,
    keyword_init: true
  )

  FakePolicy = Struct.new(:allowed) do
    def can_move_issue?(_issue_project, _board_project = _issue_project)
      allowed
    end

    def can_update_issue?(_issue_project, _board_project = _issue_project)
      allowed
    end

    def can_delete_issue?(_issue_project, _board_project = _issue_project)
      allowed
    end
  end

  def test_subtask_tree_uses_prefetched_hash_recursively
    parent = fake_issue(id: 1, subject: 'Parent')
    child = fake_issue(id: 2, parent_id: 1, subject: 'Child')
    grandchild = fake_issue(id: 3, parent_id: 2, subject: 'Grandchild')
    presenter = presenter_for(1 => [child], 2 => [grandchild])

    tree = presenter.send(:subtask_tree, parent, Set[parent.id])

    assert_equal [2], tree.map { |node| node[:id] }
    assert_equal({ id: 1, name: 'Project' }, tree.first[:project])
    assert_equal [3], tree.first[:subtasks].map { |node| node[:id] }
  end

  def test_aging_days_for_returns_days_since_update
    issue = fake_issue(id: 1, subject: 'Aged')
    issue.define_singleton_method(:updated_on) { Time.utc(2026, 7, 19) }

    assert_equal 2, travel_to(Time.utc(2026, 7, 21)) { RedmineKanban::BoardIssuePresenter.aging_days_for(issue) }
  end

  def test_allowed_status_ids_uses_redmine_workflow_for_current_user
    issue = fake_issue(id: 1, subject: 'Workflow')
    current = Struct.new(:id).new(1)
    allowed_closed = Struct.new(:id).new(3)
    issue.status = current
    issue.define_singleton_method(:new_statuses_allowed_to) { |_user| [allowed_closed] }

    presenter = presenter_for({})

    assert_equal [1, 3], presenter.send(:allowed_status_ids_for, issue)
  end

  def test_subtask_tree_skips_visited_issues
    parent = fake_issue(id: 1, subject: 'Parent')
    child = fake_issue(id: 2, parent_id: 1, subject: 'Child')
    cycle = fake_issue(id: 1, parent_id: 2, subject: 'Cycle')
    presenter = presenter_for(1 => [child], 2 => [cycle])

    tree = presenter.send(:subtask_tree, parent, Set[parent.id])

    assert_equal [2], tree.map { |node| node[:id] }
    assert_empty tree.first[:subtasks]
  end

  def test_subtask_payload_contains_fields_required_for_editing
    child = fake_issue(id: 2, parent_id: 1, subject: 'Editable child')
    child.define_singleton_method(:description) { 'Child description' }
    child.define_singleton_method(:start_date) { Date.new(2026, 8, 1) }
    child.define_singleton_method(:assigned_to) { nil }
    child.define_singleton_method(:priority) { Struct.new(:name).new('Normal') }

    payload = presenter_for(1 => [child]).send(:subtask_to_h, child)

    assert_equal 'Child description', payload[:description]
    assert_equal '2026-08-01', payload[:start_date]
    assert_equal '/issues/2', payload.dig(:urls, :issue)
    assert_equal '/issues/2/edit', payload.dig(:urls, :issue_edit)
  end

  def test_permissions_use_board_project_for_cards_and_subtasks
    board_project = Object.new
    issue_project = FakeProject.new(2, 'Issue project')
    parent = fake_issue(id: 1, subject: 'Parent', project: issue_project)
    child = fake_issue(id: 2, parent_id: 1, subject: 'Child', project: issue_project)
    calls = []
    policy = Object.new
    policy.define_singleton_method(:can_move_issue?) do |actual_issue_project, actual_board_project|
      calls << [:move, actual_issue_project, actual_board_project]
      true
    end
    policy.define_singleton_method(:can_update_issue?) do |actual_issue_project, actual_board_project|
      calls << [:update, actual_issue_project, actual_board_project]
      true
    end
    policy.define_singleton_method(:can_delete_issue?) do |actual_issue_project, actual_board_project|
      calls << [:delete, actual_issue_project, actual_board_project]
      true
    end
    presenter = RedmineKanban::BoardIssuePresenter.new(
      user: Object.new,
      subtasks_by_parent_id: { 1 => [child] },
      board_project: board_project
    )
    presenter.define_singleton_method(:permission_policy) { policy }

    presenter.send(:permissions_for, parent)
    presenter.send(:subtask_tree, parent, Set[parent.id])

    assert_equal [
      [:move, parent, board_project],
      [:update, parent, board_project],
      [:delete, parent, board_project],
      [:move, child, board_project],
      [:update, child, board_project],
      [:delete, child, board_project]
    ], calls
  end

  private

  def fake_issue(id:, subject:, parent_id: nil, project: FakeProject.new(1, 'Project'))
    FakeIssue.new(
      id: id,
      parent_id: parent_id,
      subject: subject,
      status_id: 1,
      tracker_id: 1,
      status: FakeStatus.new(1, false),
      lock_version: 1,
      project: project,
      assigned_to_id: nil,
      due_date: nil,
      priority_id: 1
    )
  end

  def presenter_for(subtasks_by_parent_id)
    RedmineKanban::BoardIssuePresenter.new(
      user: Object.new,
      subtasks_by_parent_id: subtasks_by_parent_id
    ).tap do |presenter|
      presenter.define_singleton_method(:permission_policy) { FakePolicy.new(true) }
    end
  end
end
