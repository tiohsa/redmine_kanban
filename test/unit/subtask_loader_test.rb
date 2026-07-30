require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))

class RedmineKanbanSubtaskLoaderTest < ActiveSupport::TestCase
  fixtures :projects, :users, :issues, :issue_statuses, :trackers, :enumerations

  def setup
    User.current = nil
    @user = User.find(1) # admin
    @project = Project.find(1)
  end

  def test_subtasks_by_parent_id_when_both_parent_and_child_are_in_root_ids
    # Create parent and child issue
    parent = Issue.create!(
      project: @project,
      tracker_id: 1,
      subject: 'Parent Issue',
      author: @user,
      status_id: 1,
      priority_id: 4
    )
    child = Issue.create!(
      project: @project,
      tracker_id: 1,
      subject: 'Child Issue',
      author: @user,
      status_id: 1,
      priority_id: 4,
      parent_id: parent.id
    )

    loader = RedmineKanban::SubtaskLoader.new(user: @user)
    
    # Passing both parent and child IDs to simulate what Kanban Board index query does
    result = loader.subtasks_by_parent_id([parent.id, child.id])

    # The child issue should be returned as a subtask of the parent issue
    assert_includes result[parent.id].map(&:id), child.id
  end

  def test_limits_recursive_nodes_and_reports_truncation
    parent = Issue.create!(project: @project, tracker_id: 1, subject: 'Budget parent', author: @user, status_id: 1, priority_id: 4)
    child = Issue.create!(project: @project, tracker_id: 1, subject: 'Budget child', author: @user, status_id: 1, priority_id: 4, parent_id: parent.id)
    Issue.create!(project: @project, tracker_id: 1, subject: 'Budget grandchild', author: @user, status_id: 1, priority_id: 4, parent_id: child.id)

    loader = RedmineKanban::SubtaskLoader.new(user: @user, max_nodes: 1)
    result = loader.subtasks_by_parent_id([parent.id])

    assert_equal [child.id], result.fetch(parent.id).map(&:id)
    assert_equal [child.id], loader.loaded_issue_ids
    assert_equal true, loader.truncated?
  end
end
