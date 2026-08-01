require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))

class RedmineKanbanSubtaskLoaderTest < ActiveSupport::TestCase
  parallelize(workers: 1)
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

  def test_zero_budget_fetches_no_non_root_nodes_but_reports_truncation
    parent = Issue.create!(project: @project, tracker_id: 1, subject: 'Zero budget parent', author: @user, status_id: 1, priority_id: 4)
    child = Issue.create!(project: @project, tracker_id: 1, subject: 'Zero budget child', author: @user, status_id: 1, priority_id: 4, parent_id: parent.id)

    loader = RedmineKanban::SubtaskLoader.new(user: @user, max_nodes: 0)

    assert_equal [], loader.subtasks_by_parent_id([parent.id]).fetch(parent.id, [])
    assert_equal [], loader.loaded_issue_ids
    assert_equal true, loader.truncated?
    assert_operator loader.fetched_row_count, :<=, 1
    assert Issue.exists?(child.id)
  end

  def test_exact_budget_is_not_truncated_but_one_less_is
    parent = Issue.create!(project: @project, tracker_id: 1, subject: 'Exact budget parent', author: @user, status_id: 1, priority_id: 4)
    children = 2.times.map do |index|
      Issue.create!(project: @project, tracker_id: 1, subject: "Exact budget child #{index}", author: @user, status_id: 1, priority_id: 4, parent_id: parent.id)
    end

    exact = RedmineKanban::SubtaskLoader.new(user: @user, max_nodes: children.size)
    exact_result = exact.subtasks_by_parent_id([parent.id])
    assert_equal children.map(&:id), exact_result.fetch(parent.id).map(&:id)
    assert_equal false, exact.truncated?

    short = RedmineKanban::SubtaskLoader.new(user: @user, max_nodes: children.size - 1)
    short_result = short.subtasks_by_parent_id([parent.id])
    assert_equal [children.first.id], short_result.fetch(parent.id).map(&:id)
    assert_equal true, short.truncated?
  end

  def test_budget_is_shared_fairly_across_multiple_parents
    parents = 2.times.map do |index|
      Issue.create!(project: @project, tracker_id: 1, subject: "Fair parent #{index}", author: @user, status_id: 1, priority_id: 4)
    end
    children_by_parent = parents.to_h do |parent|
      [parent.id, 3.times.map do |index|
        Issue.create!(project: @project, tracker_id: 1, subject: "Fair child #{parent.id}-#{index}", author: @user, status_id: 1, priority_id: 4, parent_id: parent.id)
      end]
    end

    loader = RedmineKanban::SubtaskLoader.new(user: @user, max_nodes: 2)
    result = loader.subtasks_by_parent_id(parents.map(&:id))

    parents.each do |parent|
      assert_equal [children_by_parent.fetch(parent.id).first.id], result.fetch(parent.id).map(&:id)
    end
    assert_equal 2, loader.loaded_issue_ids.size
    assert_equal true, loader.truncated?
  end

  def test_marks_later_parent_recoverable_when_an_earlier_parent_consumes_batch_limit
    parents = 2.times.map do |index|
      Issue.create!(project: @project, tracker_id: 1, subject: "Starvation parent #{index}", author: @user, status_id: 1, priority_id: 4)
    end
    first_children = 10.times.map do |index|
      Issue.create!(project: @project, tracker_id: 1, subject: "Starvation first child #{index}", author: @user, status_id: 1, priority_id: 4, parent_id: parents.first.id)
    end
    later_child = Issue.create!(project: @project, tracker_id: 1, subject: 'Starvation later child', author: @user, status_id: 1, priority_id: 4, parent_id: parents.last.id)

    loader = RedmineKanban::SubtaskLoader.new(user: @user, root_issue_ids: parents.map(&:id), max_nodes: 4)
    result = loader.subtasks_by_parent_id(parents.map(&:id))

    assert_equal first_children.first(2).map(&:id), result.fetch(parents.first.id).map(&:id)
    assert_equal [], result.fetch(parents.last.id, []).map(&:id)
    assert_includes loader.truncated_parent_ids, parents.last.id
    assert_not_includes loader.loaded_issue_ids, later_child.id
  end

  def test_applies_budget_before_materializing_a_high_fan_out_parent
    parent = Issue.create!(project: @project, tracker_id: 1, subject: 'High fan-out parent', author: @user, status_id: 1, priority_id: 4)
    children = 20.times.map do |index|
      Issue.create!(project: @project, tracker_id: 1, subject: "High fan-out child #{index}", author: @user, status_id: 1, priority_id: 4, parent_id: parent.id)
    end

    loader = RedmineKanban::SubtaskLoader.new(user: @user, max_nodes: 1)
    result = loader.subtasks_by_parent_id([parent.id])

    assert_equal [children.first.id], result.fetch(parent.id).map(&:id)
    assert_equal true, loader.truncated?
    assert_operator loader.fetched_row_count, :<=, 3
  end

  def test_applies_sql_limit_before_materializing_children
    parent = Issue.create!(project: @project, tracker_id: 1, subject: 'SQL limited parent', author: @user, status_id: 1, priority_id: 4)
    4.times do |index|
      Issue.create!(project: @project, tracker_id: 1, subject: "SQL limited child #{index}", author: @user, status_id: 1, priority_id: 4, parent_id: parent.id)
    end
    sql = []
    subscriber = ActiveSupport::Notifications.subscribe('sql.active_record') do |_name, _start, _finish, _id, payload|
      sql << payload[:sql].to_s if payload[:sql].to_s.include?('issues')
    end

    RedmineKanban::SubtaskLoader.new(user: @user, max_nodes: 1).subtasks_by_parent_id([parent.id])

    assert sql.any? { |statement| statement.match?(/LIMIT\s+2/i) }
  ensure
    ActiveSupport::Notifications.unsubscribe(subscriber) if subscriber
  end

  def test_root_ids_do_not_consume_descendant_budget_when_revisited
    parent = Issue.create!(project: @project, tracker_id: 1, subject: 'Root parent', author: @user, status_id: 1, priority_id: 4)
    child = Issue.create!(project: @project, tracker_id: 1, subject: 'Root child', author: @user, status_id: 1, priority_id: 4, parent_id: parent.id)
    grandchild = Issue.create!(project: @project, tracker_id: 1, subject: 'New grandchild', author: @user, status_id: 1, priority_id: 4, parent_id: child.id)

    loader = RedmineKanban::SubtaskLoader.new(user: @user, max_nodes: 1)
    result = loader.subtasks_by_parent_id([parent.id, child.id])

    assert_equal [child.id], result.fetch(parent.id).map(&:id)
    assert_equal [grandchild.id], result.fetch(child.id).map(&:id)
    assert_equal [child.id, grandchild.id], loader.loaded_issue_ids
    assert_equal false, loader.truncated?
  end

  def test_known_root_child_does_not_false_positive_truncation_when_budget_is_zero
    parent = Issue.create!(project: @project, tracker_id: 1, subject: 'Known root parent', author: @user, status_id: 1, priority_id: 4)
    child = Issue.create!(project: @project, tracker_id: 1, subject: 'Known root child', author: @user, status_id: 1, priority_id: 4, parent_id: parent.id)

    loader = RedmineKanban::SubtaskLoader.new(user: @user, max_nodes: 0)
    result = loader.subtasks_by_parent_id([parent.id, child.id])

    assert_equal [child.id], result.fetch(parent.id).map(&:id)
    assert_equal [child.id], loader.loaded_issue_ids
    assert_equal false, loader.truncated?
  end

  def test_corrupt_cycle_does_not_make_the_root_disappear
    parent = Issue.create!(project: @project, tracker_id: 1, subject: 'Cycle parent', author: @user, status_id: 1, priority_id: 4)
    child = Issue.create!(project: @project, tracker_id: 1, subject: 'Cycle child', author: @user, status_id: 1, priority_id: 4, parent_id: parent.id)
    parent.update_column(:parent_id, child.id)

    loader = RedmineKanban::SubtaskLoader.new(user: @user, max_nodes: 10)
    result = loader.subtasks_by_parent_id([parent.id])

    assert_equal [child.id], result.fetch(parent.id).map(&:id)
    assert_equal [], result.fetch(child.id, []).map(&:id)
    assert_equal [child.id], loader.loaded_issue_ids
  end

  def test_wide_tree_batches_parents_without_parent_count_queries
    parents = insert_issue_rows(count: 100, subject_prefix: 'Wide parent')
    parents.each_with_index do |parent, index|
      insert_issue_rows(count: 1, parent_id: parent.id, subject_prefix: "Wide child #{index}")
    end

    loader = RedmineKanban::SubtaskLoader.new(user: @user, root_issue_ids: parents.map(&:id), max_nodes: 1_500)
    result = loader.subtasks_by_parent_id(parents.map(&:id))

    assert_equal 100, result.values.sum(&:size)
    assert_operator loader.query_count, :<=, RedmineKanban::BoardContext::DEFAULT_TREE_QUERY_LIMIT
  end

  def test_high_fan_out_is_limited_before_materializing_all_children
    parent = Issue.create!(project: @project, tracker_id: 1, subject: 'High fan-out gate parent', author: @user, status_id: 1, priority_id: 4)
    insert_issue_rows(count: 2_000, parent_id: parent.id, subject_prefix: 'High fan-out gate child')

    loader = RedmineKanban::SubtaskLoader.new(user: @user, root_issue_ids: [parent.id], max_nodes: 1_500)
    result = loader.subtasks_by_parent_id([parent.id])

    assert_equal 1_500, result.fetch(parent.id).size
    assert_operator loader.fetched_row_count, :<=, 1_501
    assert_equal true, loader.truncated?
  end

  def test_deep_tree_stops_at_depth_limit_and_marks_continuation_unexpanded
    root = Issue.create!(project: @project, tracker_id: 1, subject: 'Deep gate root', author: @user, status_id: 1, priority_id: 4)
    parent = root
    40.times do |index|
      parent = Issue.create!(project: @project, tracker_id: 1, subject: "Deep gate #{index}", author: @user, status_id: 1, priority_id: 4, parent_id: parent.id)
    end

    loader = RedmineKanban::SubtaskLoader.new(user: @user, root_issue_ids: [root.id], max_nodes: 1_500, max_depth: 32)
    loader.subtasks_by_parent_id

    assert_operator loader.query_count, :<=, 32
    assert_equal true, loader.unexpanded_parent_ids.any?
    assert_equal true, loader.truncated?
  end

  private

  def insert_issue_rows(count:, subject_prefix:, parent_id: nil)
    now = Time.current
    rows = count.times.map do |index|
      {
        author_id: @user.id,
        project_id: @project.id,
        tracker_id: 1,
        status_id: 1,
        priority_id: 4,
        parent_id: parent_id,
        subject: "#{subject_prefix} #{index}",
        description: '',
        done_ratio: 0,
        is_private: false,
        lock_version: 0,
        created_on: now,
        updated_on: now
      }
    end
    Issue.insert_all!(rows)
    Issue.where(project_id: @project.id, parent_id: parent_id)
         .where(subject: rows.map { |row| row[:subject] })
         .order(:id).to_a
  end
end
