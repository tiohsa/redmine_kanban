require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require 'set'

require_relative '../../lib/redmine_kanban/board_issue_presenter'

class RedmineKanbanBoardIssuePresenterTest < ActiveSupport::TestCase
  FakeStatus = Struct.new(:is_closed) do
    def is_closed?
      is_closed
    end
  end

  FakeIssue = Struct.new(
    :id,
    :parent_id,
    :subject,
    :status_id,
    :status,
    :lock_version,
    :project,
    keyword_init: true
  )

  FakePolicy = Struct.new(:allowed) do
    def can_move_issue?(_project)
      allowed
    end

    def can_update_issue?(_project)
      allowed
    end

    def can_delete_issue?(_project)
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
    assert_equal [3], tree.first[:subtasks].map { |node| node[:id] }
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

  private

  def fake_issue(id:, subject:, parent_id: nil)
    FakeIssue.new(
      id: id,
      parent_id: parent_id,
      subject: subject,
      status_id: 1,
      status: FakeStatus.new(false),
      lock_version: 1,
      project: Object.new
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
