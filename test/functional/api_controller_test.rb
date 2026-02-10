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

  def ensure_member!
    member = Member.find_by(project_id: @project.id, user_id: @user.id) || Member.create!(project: @project, user: @user)
    return if member.roles.include?(@role)

    member.roles << @role
    member.save!
  end

  def build_issue(subject: 'Test issue', parent_issue_id: nil)
    tracker = @project.trackers.first || Tracker.first
    status = IssueStatus.default || IssueStatus.first
    priority = IssuePriority.active.first
    issue = Issue.new(
      project: @project,
      tracker: tracker,
      author: @user,
      status: status,
      subject: subject,
      parent_issue_id: parent_issue_id,
      priority: priority
    )
    issue.save!
    issue
  end
end
