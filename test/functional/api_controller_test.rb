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

  def test_index_returns_a_complete_flat_snapshot_and_tree_relation
    parent = build_issue(subject: 'Snapshot parent')
    child = build_issue(subject: 'Snapshot child', parent_issue_id: parent.id)

    get :index, params: { project_id: @project.identifier, board_entity_limit: 1500 }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal true, json['ok']
    assert_equal 3, json['contract_version']
    assert_equal true, json.dig('meta', 'complete')
    assert_equal json['entities'].size, json.dig('meta', 'entity_count')
    assert_operator json.dig('meta', 'query_count'), :<=, 20
    assert_equal json.dig('meta', 'response_bytes'), @response.body.bytesize
    assert_equal json['entities'].map { |entity| entity['id'] }.uniq.size, json['entities'].size
    assert_includes json['entities'].map { |entity| entity['id'] }, parent.id
    assert_includes json['entities'].map { |entity| entity['id'] }, child.id
    assert_includes json.dig('tree', 'root_ids'), parent.id
    assert_includes json.dig('tree', 'children_by_parent_id', parent.id.to_s), child.id
    refute json.key?('pagination')
  end

  def test_scope_over_limit_returns_no_partial_entities
    build_issue(subject: 'Too large one')
    build_issue(subject: 'Too large two')

    get :index, params: { project_id: @project.identifier, board_entity_limit: 1 }

    assert_response :unprocessable_entity
    json = JSON.parse(@response.body)
    assert_equal false, json['ok']
    assert_equal 3, json['contract_version']
    assert_equal 'BOARD_SCOPE_TOO_LARGE', json.dig('error', 'code')
    refute json.key?('entities')
  end

  def test_invalid_and_pagination_parameters_are_rejected
    ['0', '-1', '1.5', '1e5', 'Infinity'].each do |value|
      get :index, params: { project_id: @project.identifier, board_entity_limit: value }
      assert_response :bad_request
      assert_equal 'INVALID_BOARD_ENTITY_LIMIT', JSON.parse(@response.body).dig('error', 'code')
    end

    get :index, params: { project_id: @project.identifier, board_entity_limit: 1500, offset: 0 }
    assert_response :bad_request
    assert_equal 'BOARD_PAGINATION_UNSUPPORTED', JSON.parse(@response.body).dig('error', 'code')
  end

  def test_server_limit_is_lower_than_user_limit
    previous = ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES']
    ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES'] = '1'
    build_issue(subject: 'Server bounded one')
    build_issue(subject: 'Server bounded two')

    get :index, params: { project_id: @project.identifier, board_entity_limit: 10_000 }

    assert_response :unprocessable_entity
    json = JSON.parse(@response.body)
    assert_equal 'BOARD_SCOPE_TOO_LARGE', json.dig('error', 'code')
    assert_equal 10_000, json.dig('error', 'requested_entity_limit')
    assert_equal 1, json.dig('error', 'effective_entity_limit')
  ensure
    ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES'] = previous
  end

  def test_response_byte_limit_returns_a_structured_error_without_entities
    previous = ENV['REDMINE_KANBAN_MAX_RESPONSE_BYTES']
    ENV['REDMINE_KANBAN_MAX_RESPONSE_BYTES'] = '1'
    build_issue(subject: 'Response byte limit')

    get :index, params: { project_id: @project.identifier, board_entity_limit: 1500 }

    assert_response :unprocessable_entity
    json = JSON.parse(@response.body)
    assert_equal 'BOARD_RESPONSE_TOO_LARGE', json.dig('error', 'code')
    refute json.key?('entities')
  ensure
    ENV['REDMINE_KANBAN_MAX_RESPONSE_BYTES'] = previous
  end

  def test_query_limit_returns_a_structured_error_without_entities
    previous = ENV['REDMINE_KANBAN_MAX_BOARD_QUERIES']
    ENV['REDMINE_KANBAN_MAX_BOARD_QUERIES'] = '1'
    build_issue(subject: 'Query limit')

    get :index, params: { project_id: @project.identifier, board_entity_limit: 1500 }

    assert_response :unprocessable_entity
    json = JSON.parse(@response.body)
    assert_equal 'BOARD_QUERY_LIMIT_EXCEEDED', json.dig('error', 'code')
    refute json.key?('entities')
  ensure
    ENV['REDMINE_KANBAN_MAX_BOARD_QUERIES'] = previous
  end

  def test_status_filter_limits_the_snapshot_entities
    status_a, status_b = distinct_open_statuses
    kept = build_issue(subject: 'Filtered keep', status: status_a)
    dropped = build_issue(subject: 'Filtered drop', status: status_b)

    json = index_response(issue_status_ids: [status_a.id])
    ids = json.fetch('entities').map { |entity| entity['id'] }
    assert_includes ids, kept.id
    refute_includes ids, dropped.id
  end

  def test_entity_reconciliation_and_mutations_use_contract_version_three
    issue = build_issue(subject: 'Flat entity')
    get :entities, params: { project_id: @project.identifier, project_ids: [@project.id], ids: [issue.id] }
    assert_response :success
    assert_equal 3, JSON.parse(@response.body)['contract_version']
    assert_nil JSON.parse(@response.body).fetch('entities').first['subtasks']

    patch :update, params: { project_id: @project.identifier, id: issue.id, issue: { subject: 'Updated', lock_version: issue.lock_version } }
    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal 3, json['contract_version']
    assert_equal 'Updated', json.fetch('issue_updates').find { |candidate| candidate['id'] == issue.id }['subject']
  end

  def test_entity_reconciliation_applies_status_scope
    status_a, status_b = distinct_open_statuses
    issue = build_issue(subject: 'Scoped entity', status: status_a)

    get :entities, params: {
      project_id: @project.identifier,
      project_ids: [@project.id],
      ids: [issue.id],
      scope_status_ids_present: '1',
      scope_status_ids: [status_b.id]
    }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal [], json['entities']
    assert_equal [issue.id], json['missing_issue_ids']
    assert_equal [status_b.id], json['scope_status_ids']
  end

  def test_entity_reconciliation_applies_explicit_empty_status_scope
    issue = build_issue(subject: 'Empty scoped entity')

    get :entities, params: {
      project_id: @project.identifier,
      project_ids: [@project.id],
      ids: [issue.id],
      scope_status_ids_present: '1'
    }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal [], json['entities']
    assert_equal [issue.id], json['missing_issue_ids']
    assert_equal [], json['scope_status_ids']
  end

  def test_update_in_explicit_empty_status_scope_returns_eviction
    issue = build_issue(subject: 'Empty scope update')

    patch :update, params: {
      project_id: @project.identifier,
      id: issue.id,
      project_ids: [@project.id],
      scope_status_ids_present: '1',
      issue: { subject: 'Updated outside empty scope', lock_version: issue.lock_version }
    }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal [issue.id], json['evicted_issue_ids']
    assert_equal [], json['issue_updates']
    assert_equal [], json['created_issues']
  end

  def test_create_in_explicit_empty_status_scope_persists_and_returns_eviction
    tracker = @project.trackers.first || Tracker.first
    status = IssueStatus.first
    priority = IssuePriority.active.first

    post :create, params: {
      project_id: @project.identifier,
      project_ids: [@project.id],
      scope_status_ids_present: '1',
      issue: {
        subject: 'Created outside empty scope',
        tracker_id: tracker.id,
        status_id: status.id,
        priority_id: priority.id
      }
    }

    assert_response :success
    json = JSON.parse(@response.body)
    created = Issue.find_by(subject: 'Created outside empty scope')
    assert created
    assert_equal [], json['created_issues']
    assert_equal [created.id], json['evicted_issue_ids']
    assert_equal created.id, json.dig('issue', 'id')
  end

  def test_mutation_result_builder_evicts_issue_that_loses_visibility
    issue = build_issue(subject: 'Visibility will be lost')
    visible_before_mutation = Issue.where(id: issue.id)

    Issue.stubs(:visible).returns(visible_before_mutation, visible_before_mutation, Issue.none)
    patch :update, params: {
      project_id: @project.identifier,
      id: issue.id,
      project_ids: [@project.id],
      scope_status_ids_present: '1',
      scope_status_ids: [issue.status_id],
      issue: { subject: 'Updated after visibility change', lock_version: issue.lock_version }
    }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal [], json['issue_updates']
    assert_equal [issue.id], json['evicted_issue_ids']
    assert_equal 'Updated after visibility change', Issue.find(issue.id).subject
  end

  def test_physical_delete_returns_tombstone_not_eviction
    issue = build_issue(subject: 'Physical delete')

    delete :destroy, params: {
      project_id: @project.identifier,
      id: issue.id,
      project_ids: [@project.id],
      scope_status_ids_present: '1',
      scope_status_ids: [issue.status_id],
      lock_version: issue.lock_version
    }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal [issue.id], json['deleted_issue_ids']
    assert_equal [], json['evicted_issue_ids']
  end

  def test_read_endpoints_still_require_view_permission
    @role.remove_permission!(:view_redmine_kanban)
    get :index, params: { project_id: @project.identifier, board_entity_limit: 1500 }
    assert_response :forbidden
    get :entities, params: { project_id: @project.identifier, ids: [] }
    assert_response :forbidden
  end

  def test_counts_reconciliation_does_not_require_a_full_snapshot_admission
    previous = ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES']
    ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES'] = '1'
    build_issue(subject: 'Count one')
    build_issue(subject: 'Count two')

    get :counts, params: { project_id: @project.identifier, project_ids: [@project.id] }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal 3, json['contract_version']
    assert_kind_of Array, json['columns']
  ensure
    ENV['REDMINE_KANBAN_MAX_BOARD_ENTITIES'] = previous
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
    MemberRole.create!(member_id: member.id, role_id: @role.id) unless member.roles.include?(@role)
  end

  def build_issue(subject: 'Test issue', parent_issue_id: nil, status: nil, assigned_to: nil, priority: nil, tracker: nil, project: @project)
    tracker ||= project.trackers.first || Tracker.first
    status ||= IssueStatus.first
    priority ||= IssuePriority.active.first
    issue = Issue.new(project: project, tracker: tracker, author: @user, status: status, subject: subject, parent_issue_id: parent_issue_id, priority: priority, assigned_to: assigned_to)
    issue.save!
    issue.reload
  end

  def distinct_open_statuses
    statuses = IssueStatus.where(is_closed: false).limit(2).to_a
    statuses << IssueStatus.where.not(id: statuses.map(&:id)).first if statuses.size < 2
    statuses.compact
  end

  def index_response(extra_params = {})
    get :index, params: { project_id: @project.identifier, board_entity_limit: 1500 }.merge(extra_params)
    assert_response :success
    JSON.parse(@response.body)
  end
end
