require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))

class RedmineKanbanApiControllerTest < ActionController::TestCase
  tests RedmineKanban::ApiController

  fixtures :projects, :users, :roles, :members, :member_roles, :enabled_modules, :issues, :issue_statuses, :trackers,
           :projects_trackers, :enumerations

  def setup
    @project = projects(:projects_001)
    @user = users(:users_002)
    @role = roles(:roles_001)

    enable_kanban_module!
    grant_permissions!
    ensure_member!

    @request.session[:user_id] = @user.id
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
        subject: 'Updated subject',
        tracker_id: issue.tracker_id,
        assigned_to_id: issue.assigned_to_id,
        due_date: issue.due_date&.to_s,
        priority_id: issue.priority_id,
        description: issue.description
      }
    )

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal true, json['ok']
    assert_equal 'Updated subject', json.dig('issue', 'subject')
  end

  def test_move_updates_children_priority_when_parent_has_subtasks
    parent = build_issue(subject: 'Parent issue')
    child1 = build_issue(subject: 'Child 1', parent_issue_id: parent.id)
    child2 = build_issue(subject: 'Child 2', parent_issue_id: parent.id)
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
    parent.update!(priority: high_priority)
    child.update!(priority: high_priority)

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

    parent.update!(status: open_status, priority: default_priority)
    child1.update!(status: closed_status, priority: default_priority)
    child2.update!(status: closed_status, priority: default_priority)

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

    parent.update!(status: open_status, priority: default_priority)
    child1.update!(status: closed_status, priority: default_priority)
    child2.update!(status: closed_status, priority: default_priority)

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

  def test_destroy_works_without_plugin_authorize_mapping
    issue = build_issue

    assert_difference('Issue.count', -1) do
      delete :destroy, params: { project_id: @project.identifier, id: issue.id }
    end

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal true, json['ok']
  end

  private

  def enable_kanban_module!
    EnabledModule.find_or_create_by!(project_id: @project.id, name: 'redmine_kanban')
  end

  def grant_permissions!
    @role.add_permission!(:view_redmine_kanban) unless @role.permissions.include?(:view_redmine_kanban)
    @role.add_permission!(:manage_redmine_kanban) unless @role.permissions.include?(:manage_redmine_kanban)
    @role.add_permission!(:edit_issues) unless @role.permissions.include?(:edit_issues)
    @role.add_permission!(:delete_issues) unless @role.permissions.include?(:delete_issues)
  end

  def ensure_member!(user = @user)
    member = Member.find_by(project_id: @project.id, user_id: user.id) || Member.create!(project: @project, user: user)
    return if member.roles.include?(@role)

    member.roles << @role
    member.save!
  end

  def build_issue(subject: 'Test issue', parent_issue_id: nil, status: nil, assigned_to: nil, priority: nil)
    tracker = @project.trackers.first || Tracker.first
    status ||= IssueStatus.default || IssueStatus.first
    priority ||= IssuePriority.active.first
    issue = Issue.new(
      project: @project,
      tracker: tracker,
      author: @user,
      status: status,
      subject: subject,
      parent_issue_id: parent_issue_id,
      priority: priority,
      assigned_to: assigned_to
    )
    issue.save!
    issue
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
end
