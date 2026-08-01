require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))

class RedmineKanbanApiControllerTest < ActionController::TestCase
  tests RedmineKanban::ApiController

  fixtures :projects, :users, :roles, :members, :member_roles, :enabled_modules, :issues, :issue_statuses, :trackers,
           :projects_trackers, :enumerations

  def setup
    @previous_cache_store = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    Rails.cache.clear

    @project = projects(:projects_001)
    @user = users(:users_002)
    @role = Role.find_by(name: 'Manager') || Role.givable.first || Role.first

    enable_kanban_module!
    grant_permissions!
    ensure_member!

    @request.session[:user_id] = @user.id
  end

  def teardown
    Rails.cache = @previous_cache_store
    super
  end

  def test_index_without_filter_params_keeps_response_shape
    build_issue(subject: 'Visible issue')

    get :index, params: { project_id: @project.identifier }

    assert_response :success
    json = JSON.parse(@response.body)

    assert_equal true, json['ok']
    assert_kind_of Array, json['columns']
    assert_kind_of Array, json['issues']
    assert_kind_of Array, json['lanes']
    assert_kind_of Hash, json['labels']
    assert_equal @project.id, json.dig('meta', 'project_id')
  end

  def test_read_api_endpoints_require_view_permission
    @role.remove_permission!(:view_redmine_kanban)

    %i[bootstrap issues counts].each do |action|
      get action, params: { project_id: @project.identifier, issue_limit: 1 }
      assert_response :forbidden, "#{action} should require view_redmine_kanban"
    end
  end

  def test_all_mutation_endpoints_require_view_permission_without_changing_data
    issue = build_issue(subject: 'View permission guard')
    tracker = @project.trackers.first
    @role.remove_permission!(:view_redmine_kanban)

    assert_no_difference('Issue.count') do
      patch :move, params: { project_id: @project.identifier, id: issue.id, issue: { status_id: issue.status_id, lock_version: issue.lock_version } }
    end
    assert_response :forbidden

    assert_no_difference('Issue.count') do
      patch :update, params: { project_id: @project.identifier, id: issue.id, issue: { subject: 'Must not update', lock_version: issue.lock_version } }
    end
    assert_response :forbidden
    assert_equal 'View permission guard', issue.reload.subject

    assert_no_difference('Issue.count') do
      delete :destroy, params: { project_id: @project.identifier, id: issue.id, issue: { lock_version: issue.lock_version } }
    end
    assert_response :forbidden
    assert Issue.exists?(issue.id)

    assert_no_difference('Issue.count') do
      post :create, params: { project_id: @project.identifier, issue: { subject: 'Must not create', tracker_id: tracker.id } }
    end
    assert_response :forbidden

    @request.headers['Idempotency-Key'] = 'view-permission-bulk'
    assert_no_difference('Issue.count') do
      post :bulk_create, params: { project_id: @project.identifier, bulk: { parent: { subject: 'Must not bulk create', tracker_id: tracker.id }, subtasks: [] } }
    end
    assert_response :forbidden
  end

  def test_read_api_endpoints_allow_paged_reads_with_view_permission
    2.times { |index| build_issue(subject: "Paged issue #{index}") }

    get :bootstrap, params: { project_id: @project.identifier }
    assert_response :success

    get :issues, params: { project_id: @project.identifier, issue_limit: 1, offset: 1 }
    assert_response :success
    assert_equal 1, JSON.parse(@response.body).fetch('issues').size

    get :counts, params: { project_id: @project.identifier }
    assert_response :success
  end

  def test_issue_limit_is_clamped_to_the_server_maximum
    get :index, params: { project_id: @project.identifier, issue_limit: 100_000 }

    assert_response :success
    assert_equal RedmineKanban::BoardData::MAX_ISSUE_LIMIT, JSON.parse(@response.body).dig('meta', 'pagination', 'issue_limit')
  end

  def test_trackers_is_available_with_view_permission
    get :trackers, params: { project_id: @project.identifier }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal true, json['ok']
    assert_equal @project.trackers.sorted.map(&:id), json['trackers'].map { |tracker| tracker['id'] }
  end

  def test_index_filters_issues_by_issue_status_ids_without_changing_columns_or_counts
    status_a, status_b = distinct_open_statuses
    issue_a = build_issue(subject: 'Status filter keep', status: status_a)
    issue_b = build_issue(subject: 'Status filter drop', status: status_b)

    baseline = index_response

    json = index_response(issue_status_ids: [status_a.id])

    assert_includes json['issues'].map { |issue| issue['id'] }, issue_a.id
    refute_includes json['issues'].map { |issue| issue['id'] }, issue_b.id
    assert_includes json['columns'].map { |column| column['id'] }, status_b.id
    assert_equal column_counts_by_status(baseline), column_counts_by_status(json)
  end

  def test_index_filters_issues_by_exclude_status_ids_without_changing_columns_or_counts
    status_a, status_b = distinct_open_statuses
    issue_a = build_issue(subject: 'Exclude filter keep', status: status_a)
    issue_b = build_issue(subject: 'Exclude filter drop', status: status_b)

    baseline = index_response

    json = index_response(exclude_status_ids: [status_b.id])

    assert_includes json['issues'].map { |issue| issue['id'] }, issue_a.id
    refute_includes json['issues'].map { |issue| issue['id'] }, issue_b.id
    assert_includes json['columns'].map { |column| column['id'] }, status_b.id
    assert_equal column_counts_by_status(baseline), column_counts_by_status(json)
  end

  def test_board_omits_an_out_of_scope_descendant_from_the_recursive_tree
    parent = build_issue(subject: 'Scoped parent')
    other_project = build_project(name: 'Out of scope child', identifier: "out-of-scope-child-#{Time.now.to_i}")
    child = build_issue(subject: 'Out of scope child', project: other_project)
    # Redmine validation prevents creating this relationship normally. Defend the
    # board against historical or externally corrupted data nevertheless.
    child.update_column(:parent_id, parent.id)

    json = index_response
    card = json.fetch('issues').find { |issue| issue['id'] == parent.id }

    assert_not_nil card
    assert_equal [], card['subtasks']
    refute_includes json.fetch('issues').map { |issue| issue['id'] }, child.id
  end

  def test_move_response_omits_an_out_of_scope_descendant_from_the_recursive_tree
    parent = build_issue(subject: 'Move scoped parent')
    other_project = build_project(name: 'Move out of scope child', identifier: "move-out-of-scope-#{Time.now.to_i}")
    child = build_issue(subject: 'Move out of scope child', project: other_project)
    child.update_column(:parent_id, parent.id)

    patch :move, params: {
      project_id: @project.identifier,
      id: parent.id,
      issue: { status_id: parent.status_id, lock_version: parent.lock_version }
    }

    assert_response :success
    assert_equal [], JSON.parse(@response.body).dig('issue', 'subtasks')
  end

  def test_update_response_omits_an_out_of_scope_descendant_from_the_recursive_tree
    parent = build_issue(subject: 'Update scoped parent')
    other_project = build_project(name: 'Update out of scope child', identifier: "update-out-of-scope-child-#{Time.now.to_i}")
    child = build_issue(subject: 'Update out of scope child', project: other_project)
    child.update_column(:parent_id, parent.id)

    patch :update, params: {
      project_id: @project.identifier,
      id: parent.id,
      project_ids: [@project.id],
      issue: { subject: 'Updated scoped parent', lock_version: parent.lock_version }
    }

    assert_response :success
    assert_equal [], JSON.parse(@response.body).dig('issue', 'subtasks')
  end

  def test_board_serializes_a_page_descendant_only_once_under_its_canonical_root
    parent = build_issue(subject: 'Canonical tree parent')
    child = build_issue(subject: 'Canonical tree child', parent_issue_id: parent.id)

    json = index_response(issue_limit: RedmineKanban::BoardData::MAX_ISSUE_LIMIT)
    root_ids = json.fetch('issues').map { |issue| issue['id'] }
    parent_card = json.fetch('issues').find { |issue| issue['id'] == parent.id }

    assert_not_nil parent_card
    assert_includes parent_card.fetch('subtasks').map { |subtask| subtask['id'] }, child.id
    refute_includes root_ids, child.id
    assert_operator json.dig('meta', 'tree', 'duplicate_node_count'), :>=, 1
    assert_equal json.dig('meta', 'tree', 'unique_node_count'), json.dig('meta', 'tree', 'serialized_node_count')
  end

  def test_board_tree_budget_limits_recursive_rows_and_reports_reachable_truncation
    isolated_project = build_project(name: 'Tree budget project', identifier: "tree-budget-#{Time.now.to_i}")
    open_status, closed_status = distinct_open_statuses
    parent = build_issue(subject: 'Budget parent', project: isolated_project, status: open_status)
    child = build_issue(subject: 'Budget child', project: isolated_project, status: open_status, parent_issue_id: parent.id)
    grandchildren = 10.times.map do |index|
      build_issue(subject: "Budget grandchild #{index}", project: isolated_project, status: closed_status, parent_issue_id: child.id)
    end

    payload = RedmineKanban::BoardData.new(
      project: isolated_project,
      user: @user,
      issue_status_ids: [open_status.id],
      issue_limit: 100,
      tree_node_limit: 3
    ).to_h
    response_ids = []
    pending = payload.fetch(:issues).reverse
    until pending.empty?
      issue = pending.pop
      response_ids << issue.fetch(:id)
      pending.concat(issue.fetch(:subtasks).reverse)
    end

    tree = payload.dig(:meta, :tree)
    assert_equal [parent.id], payload.fetch(:issues).map { |issue| issue.fetch(:id) }
    assert_includes response_ids, child.id
    assert_equal 3, tree.fetch(:unique_node_count)
    assert_equal tree.fetch(:unique_node_count), tree.fetch(:serialized_node_count)
    assert_operator tree.fetch(:serialized_node_count), :<=, tree.fetch(:node_limit)
    assert_equal true, tree.fetch(:truncated)
    assert_includes tree.fetch(:truncated_parent_ids), child.id
    assert_operator tree.fetch(:db_row_count), :<, grandchildren.size
    assert_operator tree.fetch(:duplicate_node_count), :>=, 1
  end

  def test_board_exposes_unexpanded_parents_as_recoverable_tree_state
    isolated_project = build_project(name: 'Deep tree contract project', identifier: "deep-tree-contract-#{Time.now.to_i}")
    open_status = IssueStatus.where(is_closed: false).first || IssueStatus.first
    closed_status = IssueStatus.where(is_closed: true).first || IssueStatus.where.not(id: open_status.id).first
    assert_not_nil closed_status
    root = build_issue(subject: 'Deep contract root', project: isolated_project, status: open_status)
    parent = root
    34.times do |index|
      parent = build_issue(
        subject: "Deep contract child #{index}",
        project: isolated_project,
        status: closed_status,
        parent_issue_id: parent.id
      )
    end

    payload = RedmineKanban::BoardData.new(
      project: isolated_project,
      user: @user,
      issue_status_ids: [open_status.id],
      issue_limit: 100
    ).to_h
    tree = payload.fetch(:meta).fetch(:tree)

    assert_equal true, tree.fetch(:truncated)
    refute_empty tree.fetch(:unexpanded_parent_ids)
    assert_operator tree.fetch(:truncated_parent_ids).length, :>=, tree.fetch(:unexpanded_parent_ids).length
    tree.fetch(:unexpanded_parent_ids).each do |parent_id|
      state = tree.fetch(:parent_states).fetch(parent_id.to_s)
      assert_equal 'partial', state.fetch(:completeness)
      assert state.key?(:next_cursor)
    end
  end

  def test_tree_parent_page_recovers_direct_children_without_status_filter_loss
    parent = build_issue(subject: 'Tree recovery parent')
    open_status, closed_status = distinct_open_statuses
    first_child = build_issue(subject: 'Tree recovery open child', status: open_status, parent_issue_id: parent.id)
    second_child = build_issue(subject: 'Tree recovery closed child', status: closed_status, parent_issue_id: parent.id)

    get :issues, params: {
      project_id: @project.identifier,
      tree_parent_id: parent.id,
      issue_status_ids: [open_status.id],
      issue_limit: 1,
      offset: 0
    }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal [first_child.id], json.fetch('issues').map { |issue| issue.fetch('id') }
    assert_equal 2, json.dig('meta', 'pagination', 'total_issue_count')
    assert_equal 1, json.dig('meta', 'pagination', 'issue_count')
    assert_equal parent.id, json.fetch('issues').first.fetch('parent_id')
    refute_includes json.fetch('issues').map { |issue| issue.fetch('id') }, second_child.id

    get :issues, params: {
      project_id: @project.identifier,
      tree_parent_id: parent.id,
      issue_status_ids: [open_status.id],
      issue_limit: 1,
      offset: 1
    }

    assert_response :success
    assert_equal [second_child.id], JSON.parse(@response.body).fetch('issues').map { |issue| issue.fetch('id') }
  end

  def test_index_keeps_assignee_lane_from_unfiltered_issue_pool
    status_a, status_b = distinct_open_statuses
    other_user = User.active.where.not(id: @user.id).first
    assert_not_nil other_user
    ensure_member!(other_user)

    lane_seed_issue = build_issue(subject: 'Lane seed', status: status_a, assigned_to: other_user)
    visible_issue = build_issue(subject: 'Visible issue', status: status_b, assigned_to: @user)

    json = index_response(issue_status_ids: [status_b.id])

    assert_includes json['issues'].map { |issue| issue['id'] }, visible_issue.id
    refute_includes json['issues'].map { |issue| issue['id'] }, lane_seed_issue.id
    assert_includes json['lanes'].map { |lane| lane['assigned_to_id'] }, other_user.id
  end

  def test_update_works_without_plugin_authorize_mapping
    issue = build_issue

    patch(
      :update,
      params: {
        project_id: @project.identifier,
        id: issue.id,
        issue: {
          subject: 'Updated subject',
          tracker_id: issue.tracker_id,
          lock_version: issue.lock_version,
          assigned_to_id: issue.assigned_to_id,
          due_date: issue.due_date&.to_s,
          priority_id: issue.priority_id,
          description: issue.description
        }
      }
    )

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal true, json['ok']
    assert_equal 'Updated subject', json.dig('issue', 'subject')
  end

  def test_move_child_status_returns_recalculated_parent_progress
    open_status = IssueStatus.where(is_closed: false).first || IssueStatus.first
    closed_status = IssueStatus.where(is_closed: true).first || IssueStatus.first
    parent = build_issue(subject: 'Progress parent', status: open_status)
    child = build_issue(subject: 'Progress child', parent_issue_id: parent.id, status: open_status)
    parent.reload

    patch(
      :move,
      params: {
        project_id: @project.identifier,
        id: child.id,
        issue: { status_id: closed_status.id, lock_version: child.lock_version }
      }
    )

    assert_response :success
    json = JSON.parse(@response.body)
    parent.reload
    update = json['ancestor_updates'].find { |item| item['id'] == parent.id }
    assert_not_nil update
    assert_equal parent.done_ratio, update['done_ratio']
    assert_equal parent.lock_version, update['lock_version']
    assert_equal parent.updated_on.iso8601, update['updated_on']
    assert_equal (Date.current - parent.updated_on.to_date).to_i, update['aging_days']
  end

  def test_move_child_status_back_to_open_lowers_parent_progress
    open_status = IssueStatus.where(is_closed: false).first || IssueStatus.first
    closed_status = IssueStatus.where(is_closed: true).first || IssueStatus.first
    parent = build_issue(subject: 'Reopen parent', status: open_status)
    child = build_issue(subject: 'Reopen child', parent_issue_id: parent.id, status: closed_status)
    child.reload
    parent.reload
    closed_ratio = parent.done_ratio

    patch(
      :move,
      params: {
        project_id: @project.identifier,
        id: child.id,
        issue: { status_id: open_status.id, lock_version: child.lock_version }
      }
    )

    assert_response :success
    json = JSON.parse(@response.body)
    parent.reload
    assert_operator parent.done_ratio, :<, closed_ratio
    update = json['ancestor_updates'].find { |item| item['id'] == parent.id }
    assert_equal parent.done_ratio, update['done_ratio']
  end

  def test_move_child_status_and_priority_returns_all_ancestor_updates_after_priority_reload
    open_status = IssueStatus.where(is_closed: false).first || IssueStatus.first
    closed_status = IssueStatus.where(is_closed: true).first || IssueStatus.first
    priority = IssuePriority.active.where.not(id: IssuePriority.active.first.id).first || IssuePriority.active.first
    grandparent = build_issue(subject: 'Priority grandparent', status: open_status)
    parent = build_issue(subject: 'Priority parent', parent_issue_id: grandparent.id, status: open_status)
    child = build_issue(subject: 'Priority child', parent_issue_id: parent.id, status: open_status)

    patch :move, params: {
      project_id: @project.identifier,
      id: child.id,
      issue: { status_id: closed_status.id, priority_id: priority.id, lock_version: child.lock_version }
    }

    assert_response :success
    [parent, grandparent].each(&:reload)
    updates = JSON.parse(@response.body).fetch('ancestor_updates')
    [parent, grandparent].each do |ancestor|
      update = updates.find { |item| item['id'] == ancestor.id }
      assert_not_nil update
      assert_equal ancestor.done_ratio, update['done_ratio']
      assert_equal ancestor.lock_version, update['lock_version']
    end
  end

  def test_nested_child_update_returns_all_visible_ancestors
    open_status = IssueStatus.where(is_closed: false).first || IssueStatus.first
    closed_status = IssueStatus.where(is_closed: true).first || IssueStatus.first
    grandparent = build_issue(subject: 'Grandparent', status: open_status)
    parent = build_issue(subject: 'Parent', parent_issue_id: grandparent.id, status: open_status)
    child = build_issue(subject: 'Nested child', parent_issue_id: parent.id, status: open_status)

    patch(
      :move,
      params: {
        project_id: @project.identifier,
        id: child.id,
        issue: { status_id: closed_status.id, lock_version: child.lock_version }
      }
    )

    assert_response :success
    ids = JSON.parse(@response.body).fetch('ancestor_updates').map { |item| item['id'] }
    assert_includes ids, parent.id
    assert_includes ids, grandparent.id
  end

  def test_subject_update_does_not_return_unnecessary_ancestor_updates
    parent = build_issue(subject: 'No propagation parent')
    child = build_issue(subject: 'No propagation child', parent_issue_id: parent.id)

    patch(
      :update,
      params: {
        project_id: @project.identifier,
        id: child.id,
        issue: { subject: 'Changed subject', lock_version: child.lock_version }
      }
    )

    assert_response :success
    refute JSON.parse(@response.body).key?('ancestor_updates')
  end

  def test_move_updates_children_priority_when_parent_has_subtasks
    parent = build_issue(subject: 'Parent issue')
    child1 = build_issue(subject: 'Child 1', parent_issue_id: parent.id)
    child2 = build_issue(subject: 'Child 2', parent_issue_id: parent.id)
    parent.reload
    target_priority = (IssuePriority.active.where.not(id: parent.priority_id).first || IssuePriority.active.first)
    assert_not_nil target_priority

    patch(
      :move,
      params: {
        project_id: @project.identifier,
        id: parent.id,
        issue: {
          status_id: parent.status_id,
          assigned_to_id: parent.assigned_to_id,
          priority_id: target_priority.id,
          lock_version: parent.lock_version
        }
      }
    )

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal true, json['ok']

    [parent, child1, child2].each(&:reload)
    assert_equal target_priority.id, parent.priority_id
    assert_equal target_priority.id, child1.priority_id
    assert_equal target_priority.id, child2.priority_id
  end

  def test_update_priority_updates_children_when_parent_has_subtasks
    parent = build_issue(subject: 'Parent issue')
    child1 = build_issue(subject: 'Child 1', parent_issue_id: parent.id)
    child2 = build_issue(subject: 'Child 2', parent_issue_id: parent.id)
    target_priority = (IssuePriority.active.where.not(id: parent.priority_id).first || IssuePriority.active.first)
    assert_not_nil target_priority

    parent.reload
    patch(
      :update,
      params: {
        project_id: @project.identifier,
        id: parent.id,
        issue: {
          priority_id: target_priority.id,
          lock_version: parent.lock_version
        }
      }
    )

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal true, json['ok']

    [parent, child1, child2].each(&:reload)
    assert_equal target_priority.id, parent.priority_id
    assert_equal target_priority.id, child1.priority_id
    assert_equal target_priority.id, child2.priority_id
  end

  def test_move_child_status_without_priority_keeps_parent_priority
    high_priority = IssuePriority.active.where(name: 'High').first || IssuePriority.active.last || IssuePriority.active.first
    closed_status = IssueStatus.where(is_closed: true).first || IssueStatus.first
    assert_not_nil high_priority
    assert_not_nil closed_status

    parent = build_issue(subject: 'Parent issue')
    child = build_issue(subject: 'Child issue', parent_issue_id: parent.id)
    parent.reload
    parent.update!(priority: high_priority)
    child.update!(priority: high_priority)
    parent.reload

    patch(
      :move,
      params: {
        project_id: @project.identifier,
        id: child.id,
        issue: {
          status_id: closed_status.id,
          lock_version: child.lock_version
        }
      }
    )

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal true, json['ok']

    parent.reload
    child.reload
    assert_equal high_priority.id, parent.priority_id
    assert_equal high_priority.id, child.priority_id
  end

  def test_move_parent_priority_with_closed_children_keeps_selected_priority
    default_priority = IssuePriority.active.where(name: 'Normal').first || IssuePriority.active.first
    target_priority = (IssuePriority.active.where.not(id: default_priority&.id).last || IssuePriority.active.last)
    closed_status = IssueStatus.where(is_closed: true).first || IssueStatus.first
    open_status = IssueStatus.where(is_closed: false).first || IssueStatus.first
    assert_not_nil default_priority
    assert_not_nil target_priority
    assert_not_nil closed_status
    assert_not_nil open_status

    parent = build_issue(subject: 'Parent issue')
    child1 = build_issue(subject: 'Child 1', parent_issue_id: parent.id)
    child2 = build_issue(subject: 'Child 2', parent_issue_id: parent.id)

    parent.reload
    parent.update!(status: open_status, priority: default_priority)
    child1.update!(status: closed_status, priority: default_priority)
    child2.update!(status: closed_status, priority: default_priority)
    parent.reload

    patch(
      :move,
      params: {
        project_id: @project.identifier,
        id: parent.id,
        issue: {
          status_id: parent.status_id,
          priority_id: target_priority.id,
          lock_version: parent.lock_version
        }
      }
    )

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal true, json['ok']

    [parent, child1, child2].each(&:reload)
    assert_equal target_priority.id, parent.priority_id
    assert_equal target_priority.id, child1.priority_id
    assert_equal target_priority.id, child2.priority_id
  end

  def test_move_rejects_invalid_priority_and_keeps_current_priority
    current_priority = IssuePriority.active.where(name: 'High').first || IssuePriority.active.last || IssuePriority.active.first
    assert_not_nil current_priority

    issue = build_issue(subject: 'Priority guard issue')
    issue.update!(priority: current_priority)

    patch(
      :move,
      params: {
        project_id: @project.identifier,
        id: issue.id,
        issue: {
          status_id: issue.status_id,
          priority_id: 'no_priority',
          lock_version: issue.lock_version
        }
      }
    )

    assert_response :unprocessable_entity
    json = JSON.parse(@response.body)
    assert_equal false, json['ok']

    issue.reload
    assert_equal current_priority.id, issue.priority_id
  end

  def test_update_parent_priority_with_closed_children_keeps_selected_priority
    default_priority = IssuePriority.active.where(name: 'Normal').first || IssuePriority.active.first
    target_priority = (IssuePriority.active.where.not(id: default_priority&.id).last || IssuePriority.active.last)
    closed_status = IssueStatus.where(is_closed: true).first || IssueStatus.first
    open_status = IssueStatus.where(is_closed: false).first || IssueStatus.first
    assert_not_nil default_priority
    assert_not_nil target_priority
    assert_not_nil closed_status
    assert_not_nil open_status

    parent = build_issue(subject: 'Parent issue')
    child1 = build_issue(subject: 'Child 1', parent_issue_id: parent.id)
    child2 = build_issue(subject: 'Child 2', parent_issue_id: parent.id)

    parent.reload
    parent.update!(status: open_status, priority: default_priority)
    child1.update!(status: closed_status, priority: default_priority)
    child2.update!(status: closed_status, priority: default_priority)
    parent.reload

    patch(
      :update,
      params: {
        project_id: @project.identifier,
        id: parent.id,
        issue: {
          priority_id: target_priority.id,
          lock_version: parent.lock_version
        }
      }
    )

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal true, json['ok']

    [parent, child1, child2].each(&:reload)
    assert_equal target_priority.id, parent.priority_id
    assert_equal target_priority.id, child1.priority_id
    assert_equal target_priority.id, child2.priority_id
  end

  def test_update_rejects_invalid_priority_and_keeps_current_priority
    current_priority = IssuePriority.active.where(name: 'High').first || IssuePriority.active.last || IssuePriority.active.first
    assert_not_nil current_priority

    issue = build_issue(subject: 'Priority guard issue')
    issue.update!(priority: current_priority)

    patch(
      :update,
      params: {
        project_id: @project.identifier,
        id: issue.id,
        issue: {
          priority_id: 'no_priority',
          lock_version: issue.lock_version
        }
      }
    )

    assert_response :unprocessable_entity
    json = JSON.parse(@response.body)
    assert_equal false, json['ok']

    issue.reload
    assert_equal current_priority.id, issue.priority_id
  end

  def test_create_subtask_inherits_basic_properties_from_parent_when_not_specified
    parent = build_issue(subject: 'Parent issue')
    parent.update!(
      assigned_to: @user,
      start_date: Date.today,
      due_date: Date.today + 7
    )

    assert_difference('Issue.count', 1) do
      post(
        :create,
        params: {
          project_id: @project.identifier,
          issue: {
            subject: 'Child issue',
            parent_issue_id: parent.id
          }
        }
      )
    end

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal true, json['ok']

    child = Issue.find(json.dig('issue', 'id'))
    assert_equal parent.id, child.parent_issue_id
    assert_equal parent.priority_id, child.priority_id
    assert_equal parent.assigned_to_id, child.assigned_to_id
    assert_equal parent.start_date, child.start_date
    assert_equal parent.due_date, child.due_date
  end

  def test_create_subtask_does_not_inherit_properties_when_explicitly_provided
    parent = build_issue(subject: 'Parent issue')
    parent.update!(assigned_to: @user)
    other_priority = IssuePriority.active.where.not(id: parent.priority_id).first || IssuePriority.active.first
    assert_not_nil other_priority

    assert_difference('Issue.count', 1) do
      post(
        :create,
        params: {
          project_id: @project.identifier,
          issue: {
            subject: 'Child issue',
            parent_issue_id: parent.id,
            priority_id: other_priority.id,
            assigned_to_id: ''
          }
        }
      )
    end

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal true, json['ok']

    child = Issue.find(json.dig('issue', 'id'))
    assert_equal other_priority.id, child.priority_id
    assert_nil child.assigned_to_id
  end

  def test_create_subtask_rejects_parent_from_another_project
    other_project = build_project(name: 'Subtask target', identifier: "subtask-target-#{Time.now.to_i}")
    parent = build_issue(subject: 'Parent issue')

    assert_no_difference('Issue.count') do
      post(
        :create,
        params: {
          project_id: @project.identifier,
          issue: {
            subject: 'Cross-project child',
            project_id: other_project.id,
            parent_issue_id: parent.id,
            tracker_id: other_project.trackers.first.id
          }
        }
      )
    end

    assert_response :unprocessable_entity
    json = JSON.parse(@response.body)
    assert_equal false, json['ok']
    assert_includes json['message'], '一致しません'
    assert_includes json.dig('field_errors', 'project_id'), '親チケットと同じプロジェクトを指定してください'
  end

  def test_create_subtask_rejects_tracker_not_enabled_for_target_project
    unavailable_tracker = Tracker.where.not(id: @project.trackers.select(:id)).first || Tracker.create!(name: "Unavailable #{Time.now.to_i}", default_status_id: IssueStatus.first.id)

    assert_no_difference('Issue.count') do
      post(
        :create,
        params: {
          project_id: @project.identifier,
          issue: { subject: 'Invalid tracker child', tracker_id: unavailable_tracker.id }
        }
      )
    end

    assert_response :unprocessable_entity
    json = JSON.parse(@response.body)
    assert_equal false, json['ok']
    assert_includes json.dig('field_errors', 'tracker_id'), '作成先プロジェクトで利用可能なtrackerを指定してください'
  end

  def test_create_rejects_blank_subject_with_field_error
    assert_no_difference('Issue.count') do
      post :create, params: { project_id: @project.identifier, issue: { subject: ' ' } }
    end

    assert_response :unprocessable_entity
    json = JSON.parse(@response.body)
    assert_equal ['件名を入力してください'], json.dig('field_errors', 'subject')
  end

  def test_destroy_works_without_plugin_authorize_mapping
    issue = build_issue

    assert_difference('Issue.count', -1) do
      delete :destroy, params: { project_id: @project.identifier, id: issue.id, issue: { lock_version: issue.lock_version } }
    end

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal true, json['ok']
  end

  def test_destroy_requires_current_lock_version
    issue = build_issue

    delete :destroy, params: { project_id: @project.identifier, id: issue.id }

    assert_response :unprocessable_entity
    assert Issue.exists?(issue.id)
  end

  def test_top_level_issue_can_be_recreated_with_the_documented_editable_fields
    status = IssueStatus.where(is_closed: false).first || IssueStatus.first
    priority = IssuePriority.active.first
    original = build_issue(subject: 'Recreate source', status: status, priority: priority)
    original.update!(
      description: 'Recreated description',
      assigned_to: @user,
      start_date: Date.current - 2,
      due_date: Date.current + 3,
      done_ratio: 40
    )
    payload = {
      subject: original.subject,
      project_id: original.project_id,
      description: original.description,
      status_id: original.status_id,
      assigned_to_id: original.assigned_to_id,
      tracker_id: original.tracker_id,
      priority_id: original.priority_id,
      start_date: original.start_date.to_s,
      due_date: original.due_date.to_s,
      done_ratio: original.done_ratio
    }

    delete :destroy, params: { project_id: @project.identifier, id: original.id, issue: { lock_version: original.lock_version } }
    assert_response :success

    post :create, params: { project_id: @project.identifier, issue: payload }
    assert_response :success
    recreated = Issue.find(JSON.parse(@response.body).dig('issue', 'id'))

    assert_equal payload[:subject], recreated.subject
    assert_equal payload[:project_id], recreated.project_id
    assert_equal payload[:description], recreated.description
    assert_equal payload[:status_id], recreated.status_id
    assert_equal payload[:assigned_to_id], recreated.assigned_to_id
    assert_equal payload[:tracker_id], recreated.tracker_id
    assert_equal payload[:priority_id], recreated.priority_id
    assert_equal payload[:start_date], recreated.start_date.to_s
    assert_equal payload[:due_date], recreated.due_date.to_s
    assert_equal payload[:done_ratio], recreated.done_ratio
    assert_nil recreated.parent_id
  end

  def test_move_requires_lock_version_without_changing_issue
    issue = build_issue(subject: 'Move lock required')
    target_status = IssueStatus.where.not(id: issue.status_id).first
    assert_not_nil target_status

    patch :move, params: { project_id: @project.identifier, id: issue.id, issue: { status_id: target_status.id } }

    assert_response :unprocessable_entity
    assert_equal issue.status_id, issue.reload.status_id
  end

  def test_update_requires_lock_version_without_changing_issue
    issue = build_issue(subject: 'Update lock required')

    patch :update, params: { project_id: @project.identifier, id: issue.id, issue: { subject: 'Must not save' } }

    assert_response :unprocessable_entity
    assert_equal 'Update lock required', issue.reload.subject
  end

  def test_destroy_rejects_stale_lock_version_without_deleting
    issue = build_issue
    issue.update!(subject: 'Changed elsewhere')

    delete :destroy, params: { project_id: @project.identifier, id: issue.id, issue: { lock_version: issue.lock_version - 1 } }

    assert_response :conflict
    assert Issue.exists?(issue.id)
  end

  def test_bulk_create_is_atomic_and_idempotent
    tracker = @project.trackers.first
    key = 'bulk-test-key'
    @request.headers['Idempotency-Key'] = key
    params = {
      project_id: @project.identifier,
      bulk: {
        parent: { subject: 'Bulk parent', tracker_id: tracker.id },
        subtasks: [
          { subject: 'Bulk child 1', tracker_id: tracker.id },
          { subject: '', tracker_id: tracker.id }
        ]
      }
    }

    assert_no_difference('Issue.count') do
      post :bulk_create, params: params
    end
    assert_response :unprocessable_entity

    params[:bulk][:subtasks][1][:subject] = 'Bulk child 2'
    post :bulk_create, params: params
    assert_response :success
    first_result = JSON.parse(@response.body)
    assert_equal 2, first_result.fetch('subtasks').size

    assert_no_difference('Issue.count') do
      post :bulk_create, params: params
    end
    assert_response :success
    assert_equal first_result, JSON.parse(@response.body)
  end

  def test_bulk_create_rejects_more_than_fifty_subtasks_before_claim_and_allows_retry
    tracker = @project.trackers.first
    @request.headers['Idempotency-Key'] = 'bulk-limit-retry'
    too_many = Array.new(51) { |index| { subject: "Child #{index}", tracker_id: tracker.id } }

    assert_no_difference('Issue.count') do
      post :bulk_create, params: { project_id: @project.identifier, bulk: { parent: { subject: 'Too many', tracker_id: tracker.id }, subtasks: too_many } }
    end
    assert_response :unprocessable_entity
    assert_includes JSON.parse(@response.body).dig('field_errors', 'subtasks'), '子チケットは最大50件まで作成できます'

    assert_difference('Issue.count', 2) do
      post :bulk_create, params: { project_id: @project.identifier, bulk: { parent: { subject: 'Retry', tracker_id: tracker.id }, subtasks: [{ subject: 'Only child', tracker_id: tracker.id }] } }
    end
    assert_response :success
  end

  def test_bulk_create_accepts_zero_one_and_fifty_array_subtasks
    tracker = @project.trackers.first
    {
      0 => [],
      1 => [{ subject: 'Only child', tracker_id: tracker.id }],
      50 => Array.new(50) { |index| { subject: "Child #{index + 1}", tracker_id: tracker.id } }
    }.each do |count, subtasks|
      @request.headers['Idempotency-Key'] = "bulk-array-#{count}"
      assert_difference('Issue.count', count + 1) do
        post :bulk_create, params: { project_id: @project.identifier, bulk: { parent: { subject: "Array #{count}", tracker_id: tracker.id }, subtasks: subtasks } }
      end
      assert_response :success
      assert_equal count, JSON.parse(@response.body).fetch('subtasks').size
    end
  end

  def test_bulk_create_rejects_fifty_one_hash_subtasks_without_claiming_the_key
    tracker = @project.trackers.first
    @request.headers['Idempotency-Key'] = 'bulk-hash-limit-retry'
    too_many = Array.new(51) { |index| [index.to_s, { subject: "Child #{index + 1}", tracker_id: tracker.id }] }.to_h

    assert_no_difference('Issue.count') do
      post :bulk_create, params: { project_id: @project.identifier, bulk: { parent: { subject: 'Too many hash', tracker_id: tracker.id }, subtasks: too_many } }
    end
    assert_response :unprocessable_entity
    assert_includes JSON.parse(@response.body).dig('field_errors', 'subtasks'), '子チケットは最大50件まで作成できます'

    assert_difference('Issue.count', 1) do
      post :bulk_create, params: { project_id: @project.identifier, bulk: { parent: { subject: 'Hash retry', tracker_id: tracker.id }, subtasks: {} } }
    end
    assert_response :success
  end

  def test_bulk_create_rejects_malformed_rows_before_claim_and_allows_same_key_retry
    tracker = @project.trackers.first

    ['scalar', ['nested']].each_with_index do |malformed_row, index|
      key = "bulk-malformed-row-#{index}"
      @request.headers['Idempotency-Key'] = key
      malformed = { project_id: @project.identifier, bulk: { parent: { subject: "Malformed #{index}", tracker_id: tracker.id }, subtasks: [malformed_row] } }

      assert_no_difference('Issue.count', "malformed row #{malformed_row.inspect}") { post :bulk_create, params: malformed }
      assert_response :unprocessable_entity
      field_errors = JSON.parse(@response.body).fetch('field_errors')
      assert field_errors.keys.any? { |field| field.include?('subtasks[0]') }
      assert_nil Rails.cache.read(bulk_cache_key(key))

      assert_difference('Issue.count', 1) do
        post :bulk_create, params: { project_id: @project.identifier, bulk: { parent: { subject: "Retry #{index}", tracker_id: tracker.id }, subtasks: [] } }
      end
      assert_response :success
    end
  end

  def test_bulk_create_rejects_a_scalar_subtask_collection_without_claiming_the_key
    tracker = @project.trackers.first
    key = 'bulk-malformed-collection'
    @request.headers['Idempotency-Key'] = key

    assert_no_difference('Issue.count') do
      post :bulk_create, params: { project_id: @project.identifier, bulk: { parent: { subject: 'Malformed collection', tracker_id: tracker.id }, subtasks: 'scalar' } }
    end

    assert_response :unprocessable_entity
    assert_equal ['配列またはHash形式で指定してください'], JSON.parse(@response.body).dig('field_errors', 'subtasks')
    assert_nil Rails.cache.read(bulk_cache_key(key))
  end

  def test_bulk_create_rejects_a_scalar_parent_as_a_validation_error
    tracker = @project.trackers.first
    key = 'bulk-malformed-parent'
    @request.headers['Idempotency-Key'] = key

    assert_no_difference('Issue.count') do
      post :bulk_create, params: { project_id: @project.identifier, bulk: { parent: 'scalar', subtasks: [] } }
    end

    assert_response :unprocessable_entity
    assert_equal ['各行はHash形式で指定してください'], JSON.parse(@response.body).dig('field_errors', 'parent')
    assert_nil Rails.cache.read(bulk_cache_key(key))

    assert_difference('Issue.count', 1) do
      post :bulk_create, params: { project_id: @project.identifier, bulk: { parent: { subject: 'Parent retry', tracker_id: tracker.id }, subtasks: [] } }
    end
    assert_response :success
  end

  def test_bulk_create_accepts_fifty_hash_subtasks
    tracker = @project.trackers.first
    subtasks = Array.new(50) { |index| [index.to_s, { subject: "Hash child #{index + 1}", tracker_id: tracker.id }] }.to_h
    @request.headers['Idempotency-Key'] = 'bulk-hash-fifty'

    assert_difference('Issue.count', 51) do
      post :bulk_create, params: { project_id: @project.identifier, bulk: { parent: { subject: 'Hash fifty', tracker_id: tracker.id }, subtasks: subtasks } }
    end
    assert_response :success
    assert_equal 50, JSON.parse(@response.body).fetch('subtasks').size
  end

  def test_bulk_create_rejects_a_completed_key_with_a_different_payload
    tracker = @project.trackers.first
    @request.headers['Idempotency-Key'] = 'bulk-payload-conflict'
    first = { project_id: @project.identifier, bulk: { parent: { subject: 'First parent', tracker_id: tracker.id }, subtasks: [] } }

    assert_difference('Issue.count', 1) { post :bulk_create, params: first }
    assert_response :success

    assert_no_difference('Issue.count') do
      post :bulk_create, params: first.deep_merge(bulk: { parent: { subject: 'Different parent', tracker_id: tracker.id } })
    end
    assert_response :conflict
    assert_equal false, JSON.parse(@response.body)['ok']
  end

  def test_bulk_create_adds_children_to_existing_parent_atomically
    parent = build_issue(subject: 'Existing parent')
    tracker = @project.trackers.first
    @request.headers['Idempotency-Key'] = 'existing-parent-bulk-test'
    params = {
      project_id: @project.identifier,
      bulk: {
        parent: { parent_issue_id: parent.id, project_id: @project.id },
        subtasks: [
          { subject: 'Child to rollback', tracker_id: tracker.id },
          { subject: '', tracker_id: tracker.id }
        ]
      }
    }

    assert_no_difference('Issue.count') do
      post :bulk_create, params: params
    end
    assert_response :unprocessable_entity
    assert_equal 0, parent.reload.children.count

    params[:bulk][:subtasks][1][:subject] = 'Child that persists'
    assert_difference('Issue.count', 2) do
      post :bulk_create, params: params.merge(bulk: params[:bulk].merge(parent: { parent_issue_id: parent.id }))
    end
    assert_response :success
    assert_equal 2, parent.reload.children.count
  end

  def test_bulk_create_returns_conflict_for_processing_cache_entry
    key = 'processing-cache-test'
    Rails.cache.write(
      bulk_cache_key(key),
      { 'status' => 'processing', 'payload_digest' => bulk_payload_digest(parent: {}, subtasks: []) },
      expires_in: RedmineKanban::BulkIdempotency::PROCESSING_TTL
    )

    assert_no_difference('Issue.count') do
      @request.headers['Idempotency-Key'] = key
      post :bulk_create, params: { project_id: @project.identifier, bulk: { parent: {}, subtasks: [] } }
    end

    assert_response :conflict
    assert_equal '同じ一括作成リクエストが処理中です', JSON.parse(@response.body)['message']
  ensure
    Rails.cache.delete(bulk_cache_key(key))
  end

  def test_bulk_create_returns_completed_cache_result_without_creating_again
    key = 'completed-cache-test'
    response = { 'ok' => true, 'issue' => { 'id' => 999 }, 'subtasks' => [] }
    Rails.cache.write(
      bulk_cache_key(key),
      { 'status' => 'completed', 'payload_digest' => bulk_payload_digest(parent: {}, subtasks: []), 'response' => response },
      expires_in: RedmineKanban::BulkIdempotency::COMPLETED_TTL
    )

    assert_no_difference('Issue.count') do
      @request.headers['Idempotency-Key'] = key
      post :bulk_create, params: { project_id: @project.identifier, bulk: { parent: {}, subtasks: [] } }
    end

    assert_response :success
    assert_equal response, JSON.parse(@response.body)
  ensure
    Rails.cache.delete(bulk_cache_key(key))
  end

  def test_index_returns_viewable_projects_and_allows_non_descendant_filter_selection
    other_project = build_project(name: 'Other Kanban', identifier: "other-kanban-#{Time.now.to_i}")
    other_tracker = Tracker.create!(name: "Other tracker #{Time.now.to_i}", default_status_id: IssueStatus.first.id)
    other_project.trackers << other_tracker
    other_issue = build_issue(subject: 'Other project issue', project: other_project)

    json = index_response(project_ids: [other_project.id])

    assert_includes json.dig('lists', 'viewable_projects').map { |project| project['id'] }, other_project.id
    assert_includes json.dig('lists', 'creatable_projects').map { |project| project['id'] }, other_project.id
    assert_includes json.dig('lists', 'trackers').map { |tracker| tracker['id'] }, other_tracker.id
    assert_equal [other_issue.id], json['issues'].map { |issue| issue['id'] }
    assert_equal [other_project.id], json.dig('meta', 'project_ids')
  end

  def test_index_includes_trackers_from_active_visible_descendant_projects
    child_project = build_project(
      name: 'Kanban Child',
      identifier: "kanban-child-#{Time.now.to_i}",
      parent: @project
    )
    child_tracker = Tracker.create!(name: "Child tracker #{Time.now.to_i}", default_status_id: IssueStatus.first.id)
    child_project.trackers << child_tracker
    @project.reload

    json = index_response

    assert_includes json.dig('lists', 'trackers').map { |tracker| tracker['id'] }, child_tracker.id
  end

  def test_move_allows_issue_from_non_descendant_project_with_kanban_disabled
    other_project = build_project(
      name: 'Move Target',
      identifier: "move-target-#{Time.now.to_i}",
      kanban_enabled: false
    )
    issue = build_issue(subject: 'Cross project move', project: other_project)
    closed_status = IssueStatus.where.not(id: issue.status_id).where(is_closed: true).first || IssueStatus.where.not(id: issue.status_id).first
    assert_not_nil closed_status

    board_json = index_response(project_ids: [other_project.id])
    card = board_json['issues'].find { |item| item['id'] == issue.id }
    assert_not_nil card
    assert_equal true, card.dig('permissions', 'can_move')

    patch(
      :move,
      params: {
        project_id: @project.identifier,
        id: issue.id,
        issue: {
          status_id: closed_status.id,
          lock_version: issue.lock_version
        }
      }
    )

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal true, json.dig('issue', 'permissions', 'can_move')
    issue.reload
    assert_equal closed_status.id, issue.status_id
  end

  def test_move_rejects_cross_project_issue_without_edit_permission
    other_project = build_project(
      name: 'No Edit Target',
      identifier: "no-edit-target-#{Time.now.to_i}",
      kanban_enabled: false
    )
    issue = build_issue(subject: 'Cannot edit target', project: other_project)
    @role.remove_permission!(:edit_issues)

    patch(
      :move,
      params: {
        project_id: @project.identifier,
        id: issue.id,
        issue: { status_id: issue.status_id, lock_version: issue.lock_version }
      }
    )

    assert_response :forbidden
    assert_equal false, JSON.parse(@response.body)['ok']
  end

  def test_move_rejects_cross_project_issue_without_board_manage_permission
    other_project = build_project(
      name: 'No Board Manage Target',
      identifier: "no-board-manage-target-#{Time.now.to_i}",
      kanban_enabled: false
    )
    issue = build_issue(subject: 'Cannot manage board', project: other_project)
    @role.remove_permission!(:manage_redmine_kanban)

    patch(
      :move,
      params: {
        project_id: @project.identifier,
        id: issue.id,
        issue: { status_id: issue.status_id, lock_version: issue.lock_version }
      }
    )

    assert_response :forbidden
    assert_equal false, JSON.parse(@response.body)['ok']
  end

  def test_update_allows_issue_from_non_descendant_project
    other_project = build_project(name: 'Update Target', identifier: "update-target-#{Time.now.to_i}")
    issue = build_issue(subject: 'Before update', project: other_project)

    patch(
      :update,
      params: {
        project_id: @project.identifier,
        id: issue.id,
        issue: {
          subject: 'After update',
          lock_version: issue.lock_version
        }
      }
    )

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal true, json.dig('issue', 'permissions', 'can_move')
    issue.reload
    assert_equal 'After update', issue.subject
  end

  def test_create_uses_issue_project_id_for_non_descendant_project
    other_project = build_project(name: 'Create Target', identifier: "create-target-#{Time.now.to_i}")

    assert_difference('Issue.where(project_id: other_project.id).count', 1) do
      post(
        :create,
        params: {
          project_id: @project.identifier,
          issue: {
            subject: 'Created in other project',
            project_id: other_project.id,
            tracker_id: other_project.trackers.first&.id || Tracker.first.id,
          }
        }
      )
    end

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal other_project.id, json.dig('issue', 'project', 'id')
  end

  private

  def enable_kanban_module!
    EnabledModule.find_or_create_by!(project_id: @project.id, name: 'redmine_kanban')
  end

  def grant_permissions!
    @role.add_permission!(:view_redmine_kanban) unless @role.permissions.include?(:view_redmine_kanban)
    @role.add_permission!(:manage_redmine_kanban) unless @role.permissions.include?(:manage_redmine_kanban)
    @role.add_permission!(:add_issues) unless @role.permissions.include?(:add_issues)
    @role.add_permission!(:edit_issues) unless @role.permissions.include?(:edit_issues)
    @role.add_permission!(:delete_issues) unless @role.permissions.include?(:delete_issues)
  end

  def ensure_member!(user = @user, project = @project)
    member = Member.find_by(project_id: project.id, user_id: user.id) || Member.create!(project: project, user: user, role_ids: [@role.id])
    return if member.roles.include?(@role)

    MemberRole.create!(member_id: member.id, role_id: @role.id)
  end

  def build_issue(subject: 'Test issue', parent_issue_id: nil, status: nil, assigned_to: nil, priority: nil, project: @project)
    tracker = project.trackers.first || Tracker.first
    status ||= IssueStatus.first
    priority ||= IssuePriority.active.first
    issue = Issue.new(
      project: project,
      tracker: tracker,
      author: @user,
      status: status,
      subject: subject,
      parent_issue_id: parent_issue_id,
      priority: priority,
      assigned_to: assigned_to
    )
    issue.save!
    issue.reload
    issue
  end

  def build_project(name:, identifier:, kanban_enabled: true, parent: nil)
    project = Project.new(name: name, identifier: identifier, parent: parent)
    project.save!
    EnabledModule.find_or_create_by!(project_id: project.id, name: 'issue_tracking')
    EnabledModule.find_or_create_by!(project_id: project.id, name: 'redmine_kanban') if kanban_enabled
    tracker = @project.trackers.first || Tracker.first
    project.trackers << tracker unless project.trackers.include?(tracker)
    ensure_member!(@user, project)
    project
  end

  def distinct_open_statuses
    statuses = IssueStatus.where(is_closed: false).limit(2).to_a
    statuses << IssueStatus.where.not(id: statuses.map(&:id)).first if statuses.size < 2
    statuses.compact!
    assert_equal 2, statuses.size

    statuses
  end

  def index_response(extra_params = {})
    get :index, params: { project_id: @project.identifier }.merge(extra_params)
    assert_response :success

    JSON.parse(@response.body)
  end

  def column_counts_by_status(json)
    json['columns'].to_h { |column| [column['id'], column['count']] }
  end

  def bulk_cache_key(key)
    ['redmine_kanban', 'bulk_create', @user.id, @project.id, key].join(':')
  end

  def bulk_payload_digest(payload)
    RedmineKanban::BulkIdempotency.send(:payload_digest, payload)
  end

end
