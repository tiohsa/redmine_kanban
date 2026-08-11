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

  def test_index_tracker_list_includes_workflow_metadata
    json = index_response
    tracker = @project.trackers.first || Tracker.first
    item = json.fetch('lists').fetch('trackers').find { |candidate| candidate['id'] == tracker.id }

    assert item
    assert item.key?('workflow_status_ids')
    assert item.key?('default_status_id')
    assert item.key?('available_project_ids')
    assert_includes item.fetch('available_project_ids'), @project.id
  end

  def test_workflow_rejection_returns_a_machine_readable_error_code
    issue = build_issue(subject: 'Workflow rejection')
    allowed_status_ids = [issue.status_id, *issue.new_statuses_allowed_to(@user).map(&:id)]
    denied_status = IssueStatus.where.not(id: allowed_status_ids).first
    skip 'fixture has no denied workflow status' unless denied_status

    patch :update, params: {
      project_id: @project.identifier,
      id: issue.id,
      issue: { status_id: denied_status.id, lock_version: issue.lock_version }
    }

    assert_response :unprocessable_entity
    json = JSON.parse(@response.body)
    assert_equal false, json['ok']
    assert_equal 'WORKFLOW_TRANSITION_NOT_ALLOWED', json.dig('error', 'code')
  end

  def test_trackers_endpoint_uses_the_shared_metadata_semantics_for_target_project
    tracker = @project.trackers.first || Tracker.first

    get :trackers, params: { project_id: @project.identifier, target_project_id: @project.id }

    assert_response :success
    item = JSON.parse(@response.body).fetch('trackers').find { |candidate| candidate['id'] == tracker.id }
    assert item
    assert_equal [@project.id], item.fetch('available_project_ids')
    assert item.key?('workflow_status_ids')
    assert item.key?('default_status_id')
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

  def test_primary_at_limit_with_dependency_descendant_returns_structured_overflow
    primary_status, dependency_status = create_boundary_statuses
    parent = build_issue(subject: 'Exact primary boundary parent', status: primary_status)
    build_issue(subject: 'Exact primary boundary dependency', parent_issue_id: parent.id, status: dependency_status)

    get :index, params: {
      project_id: @project.identifier,
      board_entity_limit: 1,
      issue_status_ids: [primary_status.id, dependency_status.id],
      exclude_status_ids: [dependency_status.id]
    }

    assert_response :unprocessable_entity
    json = JSON.parse(@response.body)
    assert_equal 'BOARD_SCOPE_TOO_LARGE', json.dig('error', 'code')
    refute json.key?('entities')
  end

  def test_dependency_admission_uses_remaining_plus_one_probe
    primary_status, dependency_status = create_boundary_statuses
    parent = build_issue(subject: 'Remaining boundary parent', status: primary_status)
    first_child = build_issue(subject: 'Remaining boundary child one', parent_issue_id: parent.id, status: dependency_status)

    params = {
      project_id: @project.identifier,
      board_entity_limit: 2,
      issue_status_ids: [primary_status.id, dependency_status.id],
      exclude_status_ids: [dependency_status.id]
    }
    get :index, params: params
    assert_response :success
    assert_equal 2, JSON.parse(@response.body).dig('meta', 'entity_count')

    build_issue(subject: 'Remaining boundary child two', parent_issue_id: parent.id, status: dependency_status)
    get :index, params: params
    assert_response :unprocessable_entity
    assert_equal 'BOARD_SCOPE_TOO_LARGE', JSON.parse(@response.body).dig('error', 'code')
    refute JSON.parse(@response.body).key?('entities')
    assert first_child.persisted?
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

  def test_hidden_closed_child_remains_a_tree_dependency
    open_status = IssueStatus.where(is_closed: false).first
    closed_status = IssueStatus.where(is_closed: true).first
    skip 'requires both open and closed statuses' unless open_status && closed_status
    parent = build_issue(subject: 'Visible parent', status: open_status)
    child = build_issue(subject: 'Hidden closed child', parent_issue_id: parent.id, status: closed_status)

    json = index_response(issue_status_ids: IssueStatus.pluck(:id), exclude_status_ids: [closed_status.id])
    ids = json.fetch('entities').map { |entity| entity['id'] }
    assert_includes ids, parent.id
    assert_includes ids, child.id
    assert_includes json.dig('tree', 'root_ids'), parent.id
    assert_includes json.dig('tree', 'children_by_parent_id', parent.id.to_s), child.id
    assert_equal IssueStatus.sorted.pluck(:id) - [closed_status.id], json.dig('meta', 'scope_status_ids')
    assert_includes json.dig('meta', 'dependency_status_ids'), closed_status.id
  end

  def test_member_ids_treats_hidden_closed_child_as_dependency
    open_status = IssueStatus.where(is_closed: false).first
    closed_status = IssueStatus.where(is_closed: true).first
    skip 'requires both open and closed statuses' unless open_status && closed_status
    parent = build_issue(subject: 'Resolver parent', status: open_status)
    child = build_issue(subject: 'Resolver hidden child', parent_issue_id: parent.id, status: closed_status)
    context = RedmineKanban::BoardContext.new(
      project: @project,
      user: @user,
      project_ids: [@project.id],
      scope_status_ids: [open_status.id],
      dependency_status_ids: [open_status.id, closed_status.id]
    )

    member_ids = RedmineKanban::BoardMembershipResolver.new(board_context: context).member_ids([child.id])

    assert_includes member_ids, child.id
  end

  def test_member_ids_does_not_cross_independent_nested_set_roots
    open_status = IssueStatus.where(is_closed: false).first
    closed_status = IssueStatus.where(is_closed: true).first
    skip 'requires both open and closed statuses' unless open_status && closed_status
    primary_parent = build_issue(subject: 'Primary root', status: open_status)
    build_issue(subject: 'Primary root child', parent_issue_id: primary_parent.id, status: open_status)
    other_parent = build_issue(subject: 'Other root', status: closed_status)
    other_child = build_issue(subject: 'Other root child', parent_issue_id: other_parent.id, status: closed_status)
    context = RedmineKanban::BoardContext.new(
      project: @project,
      user: @user,
      project_ids: [@project.id],
      scope_status_ids: [open_status.id],
      dependency_status_ids: [open_status.id, closed_status.id]
    )

    member_ids = RedmineKanban::BoardMembershipResolver.new(board_context: context).member_ids([other_child.id])

    refute_includes member_ids, other_child.id
  end

  def test_status_loss_evicts_descendant_closure_in_one_mutation_result
    open_status = IssueStatus.where(is_closed: false).first
    closed_status = IssueStatus.where(is_closed: true).first
    skip 'requires both open and closed statuses' unless open_status && closed_status
    parent = build_issue(subject: 'Status loss parent', status: open_status)
    child = build_issue(subject: 'Status loss child', parent_issue_id: parent.id, status: closed_status)
    parent = Issue.find(parent.id)

    patch :update, params: {
      project_id: @project.identifier,
      id: parent.id,
      project_ids: [@project.id],
      scope_status_ids_present: '1',
      scope_status_ids: [open_status.id],
      dependency_status_ids_present: '1',
      dependency_status_ids: [open_status.id, closed_status.id],
      issue: { status_id: closed_status.id, lock_version: parent.lock_version }
    }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_includes json.fetch('evicted_issue_ids'), parent.id
    assert_includes json.fetch('evicted_issue_ids'), child.id
    refute_includes json.fetch('issue_updates').map { |issue| issue['id'] }, child.id
  end

  def test_status_gain_adds_descendant_closure_in_one_mutation_result
    open_status = IssueStatus.where(is_closed: false).first
    closed_status = IssueStatus.where(is_closed: true).first
    skip 'requires both open and closed statuses' unless open_status && closed_status
    parent = build_issue(subject: 'Status gain parent', status: closed_status)
    child = build_issue(subject: 'Status gain child', parent_issue_id: parent.id, status: closed_status)
    parent = Issue.find(parent.id)

    patch :update, params: {
      project_id: @project.identifier,
      id: parent.id,
      project_ids: [@project.id],
      scope_status_ids_present: '1',
      scope_status_ids: [open_status.id],
      dependency_status_ids_present: '1',
      dependency_status_ids: [open_status.id, closed_status.id],
      issue: { status_id: open_status.id, lock_version: parent.lock_version }
    }

    assert_response :success
    json = JSON.parse(@response.body)
    update_ids = json.fetch('issue_updates').map { |issue| issue['id'] }
    assert_includes update_ids, parent.id
    assert_includes update_ids, child.id
    refute_includes json.fetch('evicted_issue_ids'), child.id
  end

  def test_primary_membership_gain_does_not_evict_dependency_scope_outside_child
    open_status = IssueStatus.where(is_closed: false).first
    closed_status = IssueStatus.where(is_closed: true).first
    skip 'requires both open and closed statuses' unless open_status && closed_status
    outside_status = IssueStatus.create!(
      name: 'Kanban outside scope',
      is_closed: true,
      position: IssueStatus.maximum(:position).to_i + 1
    )
    parent = build_issue(subject: 'Bounded candidate parent', status: closed_status)
    dependency_child = build_issue(subject: 'Bounded dependency child', parent_issue_id: parent.id, status: closed_status)
    outside_child = build_issue(subject: 'Out of dependency scope child', parent_issue_id: parent.id, status: outside_status)
    parent = Issue.find(parent.id)

    patch :update, params: {
      project_id: @project.identifier,
      id: parent.id,
      project_ids: [@project.id],
      scope_status_ids_present: '1',
      scope_status_ids: [open_status.id],
      dependency_status_ids_present: '1',
      dependency_status_ids: [open_status.id, closed_status.id],
      issue: { status_id: open_status.id, lock_version: parent.lock_version }
    }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_includes json.fetch('issue_updates').map { |issue| issue['id'] }, dependency_child.id
    refute_includes json.fetch('issue_updates').map { |issue| issue['id'] }, outside_child.id
    refute_includes json.fetch('evicted_issue_ids'), outside_child.id
  end

  def test_primary_membership_true_to_true_does_not_recheck_dependency_closure
    first_open, second_open = distinct_open_statuses
    closed_status = IssueStatus.where(is_closed: true).first
    skip 'requires two open and one closed status' unless first_open && second_open && closed_status
    parent = build_issue(subject: 'Stable primary parent', status: first_open)
    child = build_issue(subject: 'Stable dependency child', parent_issue_id: parent.id, status: closed_status)
    parent = Issue.find(parent.id)

    patch :update, params: {
      project_id: @project.identifier,
      id: parent.id,
      project_ids: [@project.id],
      scope_status_ids_present: '1',
      scope_status_ids: [first_open.id, second_open.id],
      dependency_status_ids_present: '1',
      dependency_status_ids: [first_open.id, second_open.id, closed_status.id],
      issue: { status_id: second_open.id, lock_version: parent.lock_version }
    }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_includes json.fetch('issue_updates').map { |issue| issue['id'] }, parent.id
    refute_includes json.fetch('issue_updates').map { |issue| issue['id'] }, child.id
  end

  def test_mutation_overflow_persists_domain_change_and_invalidates_board_snapshot
    issue = build_issue(subject: 'Mutation admission boundary')

    patch :update, params: {
      project_id: @project.identifier,
      id: issue.id,
      project_ids: [@project.id],
      board_entity_limit: 1,
      scope_status_ids_present: '1',
      scope_status_ids: [issue.status_id],
      issue: { subject: 'Persisted over board limit', lock_version: issue.lock_version }
    }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal true, json.dig('invalidations', 'board_snapshot')
    assert_equal [], json.fetch('issue_updates')
    assert_equal 'Persisted over board limit', Issue.find(issue.id).subject
  end

  def test_create_overflow_persists_issue_without_partial_created_delta
    tracker = @project.trackers.first || Tracker.first
    status = IssueStatus.first
    priority = IssuePriority.active.first
    build_issue(subject: 'Existing board admission entity', status: status)

    post :create, params: {
      project_id: @project.identifier,
      project_ids: [@project.id],
      board_entity_limit: 1,
      scope_status_ids_present: '1',
      scope_status_ids: [status.id],
      issue: {
        subject: 'Created over board admission limit',
        tracker_id: tracker.id,
        status_id: status.id,
        priority_id: priority.id
      }
    }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal true, json.dig('invalidations', 'board_snapshot')
    assert_equal [], json.fetch('created_issues')
    refute json.key?('issue')
    assert Issue.find_by(subject: 'Created over board admission limit')
  end

  def test_bulk_create_overflow_persists_rows_without_legacy_entity_dtos
    tracker = @project.trackers.first || Tracker.first
    status = IssueStatus.first
    priority = IssuePriority.active.first
    build_issue(subject: 'Existing bulk admission entity', status: status)

    post :bulk_create, params: {
      project_id: @project.identifier,
      project_ids: [@project.id],
      board_entity_limit: 1,
      scope_status_ids_present: '1',
      scope_status_ids: [status.id],
      bulk: {
        parent: {
          subject: 'Bulk parent over admission limit',
          tracker_id: tracker.id,
          status_id: status.id,
          priority_id: priority.id
        },
        subtasks: [{
          subject: 'Bulk child over admission limit',
          tracker_id: tracker.id,
          status_id: status.id,
          priority_id: priority.id
        }]
      }
    }.tap { |params| @request.headers['Idempotency-Key'] = 'bulk-overflow-legacy-dtos' }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal true, json.dig('invalidations', 'board_snapshot')
    assert_equal [], json.fetch('created_issues')
    refute json.key?('issue')
    refute json.key?('subtasks')
    assert Issue.find_by(subject: 'Bulk parent over admission limit')
    assert Issue.find_by(subject: 'Bulk child over admission limit')
  end

  def test_mutation_response_byte_overflow_returns_snapshot_invalidation
    previous = ENV['REDMINE_KANBAN_MAX_RESPONSE_BYTES']
    ENV['REDMINE_KANBAN_MAX_RESPONSE_BYTES'] = '1'
    issue = build_issue(subject: 'Mutation response byte boundary')

    patch :update, params: {
      project_id: @project.identifier,
      id: issue.id,
      project_ids: [@project.id],
      scope_status_ids_present: '1',
      scope_status_ids: [issue.status_id],
      issue: { subject: 'Persisted despite response bound', lock_version: issue.lock_version }
    }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal true, json.dig('invalidations', 'board_snapshot')
    assert_equal [], json.fetch('issue_updates')
    refute json.key?('issue')
  ensure
    ENV['REDMINE_KANBAN_MAX_RESPONSE_BYTES'] = previous
  end

  def test_visibility_loss_discovers_descendants_after_anchor_is_invisible
    previous_visibility = @role.issues_visibility
    @role.update!(issues_visibility: 'own')
    other_user = users(:users_001)
    ensure_member!(other_user)
    open_status = IssueStatus.where(is_closed: false).first
    closed_status = IssueStatus.where(is_closed: true).first
    skip 'requires both open and closed statuses' unless open_status && closed_status
    parent = build_issue(subject: 'Visibility parent', status: open_status, assigned_to: @user, author: other_user)
    child = build_issue(subject: 'Visibility child', parent_issue_id: parent.id, status: closed_status, assigned_to: @user, author: other_user)
    parent = Issue.find(parent.id)

    patch :update, params: {
      project_id: @project.identifier,
      id: parent.id,
      project_ids: [@project.id],
      scope_status_ids_present: '1',
      scope_status_ids: [open_status.id],
      dependency_status_ids_present: '1',
      dependency_status_ids: [open_status.id, closed_status.id],
      issue: { assigned_to_id: other_user.id, lock_version: parent.lock_version }
    }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_includes json.fetch('evicted_issue_ids'), parent.id
    assert_includes json.fetch('evicted_issue_ids'), child.id
  ensure
    @role.update!(issues_visibility: previous_visibility) if previous_visibility
  end

  def test_primary_child_survives_parent_status_loss
    open_status = IssueStatus.where(is_closed: false).first
    closed_status = IssueStatus.where(is_closed: true).first
    loss_status = IssueStatus.where(is_closed: false).where.not(id: open_status&.id).first
    skip 'requires two open and one closed status' unless open_status && closed_status && loss_status
    parent = build_issue(subject: 'Independent primary parent', status: open_status)
    child = build_issue(subject: 'Independent primary child', parent_issue_id: parent.id, status: open_status)
    parent = Issue.find(parent.id)

    patch :update, params: {
      project_id: @project.identifier,
      id: parent.id,
      project_ids: [@project.id],
      scope_status_ids_present: '1',
      scope_status_ids: [open_status.id],
      dependency_status_ids_present: '1',
      dependency_status_ids: [open_status.id, closed_status.id],
      issue: { status_id: loss_status.id, lock_version: parent.lock_version }
    }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_includes json.fetch('issue_updates').map { |issue| issue['id'] }, child.id
    refute_includes json.fetch('evicted_issue_ids'), child.id
  end

  def test_standalone_hidden_closed_issue_is_not_a_dependency
    open_status = IssueStatus.where(is_closed: false).first
    closed_status = IssueStatus.where(is_closed: true).first
    skip 'requires both open and closed statuses' unless open_status && closed_status
    issue = build_issue(subject: 'Standalone hidden closed', status: closed_status)

    json = index_response(issue_status_ids: IssueStatus.pluck(:id), exclude_status_ids: [closed_status.id])
    refute_includes json.fetch('entities').map { |entity| entity['id'] }, issue.id
  end

  def test_mutation_keeps_hidden_closed_child_when_parent_is_in_primary_scope
    open_status = IssueStatus.where(is_closed: false).first
    closed_status = IssueStatus.where(is_closed: true).first
    skip 'requires both open and closed statuses' unless open_status && closed_status
    parent = build_issue(subject: 'Mutation parent', status: open_status)
    child = build_issue(subject: 'Mutation closed child', parent_issue_id: parent.id, status: closed_status)

    patch :update, params: {
      project_id: @project.identifier,
      id: child.id,
      project_ids: [@project.id],
      scope_status_ids_present: '1',
      scope_status_ids: [open_status.id],
      dependency_status_ids_present: '1',
      dependency_status_ids: IssueStatus.pluck(:id),
      issue: { subject: 'Mutation closed child updated', lock_version: child.lock_version }
    }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_includes json.fetch('issue_updates').map { |issue| issue['id'] }, child.id
    refute_includes json.fetch('evicted_issue_ids'), child.id
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
    previous_visibility = @role.issues_visibility
    @role.update!(issues_visibility: 'own')
    other_user = users(:users_001)
    ensure_member!(other_user)
    issue = build_issue(subject: 'Visibility will be lost', author: other_user, assigned_to: @user)
    assert issue.visible?(@user)

    patch :update, params: {
      project_id: @project.identifier,
      id: issue.id,
      project_ids: [@project.id],
      scope_status_ids_present: '1',
      scope_status_ids: [issue.status_id],
      issue: { assigned_to_id: other_user.id, subject: 'Updated after visibility change', lock_version: issue.lock_version }
    }

    assert_response :success
    refute issue.reload.visible?(@user)
    json = JSON.parse(@response.body)
    assert_equal [], json['issue_updates']
    assert_equal [issue.id], json['evicted_issue_ids']
    assert_equal 'Updated after visibility change', Issue.find(issue.id).subject
  ensure
    @role.update!(issues_visibility: previous_visibility) if previous_visibility
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

  def test_physical_delete_returns_board_visible_cascade_tombstones
    status = IssueStatus.first
    parent = build_issue(subject: 'Physical delete parent', status: status)
    child = build_issue(subject: 'Physical delete child', parent_issue_id: parent.id, status: status)
    grandchild = build_issue(subject: 'Physical delete grandchild', parent_issue_id: child.id, status: status)

    delete :destroy, params: {
      project_id: @project.identifier,
      id: parent.id,
      project_ids: [@project.id],
      scope_status_ids_present: '1',
      scope_status_ids: [status.id],
      lock_version: parent.lock_version
    }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal [parent.id, child.id, grandchild.id].sort, json['deleted_issue_ids'].sort
    assert_nil Issue.find_by(id: parent.id)
    assert_nil Issue.find_by(id: child.id)
    assert_nil Issue.find_by(id: grandchild.id)
  end

  def test_physical_delete_does_not_report_out_of_scope_descendant
    status = IssueStatus.first
    outside_status = IssueStatus.where.not(id: status.id).first
    skip 'requires at least two issue statuses' unless outside_status
    parent = build_issue(subject: 'Scoped delete parent', status: status)
    visible_child = build_issue(subject: 'Scoped delete child', parent_issue_id: parent.id, status: status)
    outside_child = build_issue(subject: 'Out of scope child', parent_issue_id: parent.id, status: outside_status)

    delete :destroy, params: {
      project_id: @project.identifier,
      id: parent.id,
      project_ids: [@project.id],
      scope_status_ids_present: '1',
      scope_status_ids: [status.id],
      lock_version: parent.lock_version
    }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal [parent.id, visible_child.id].sort, json['deleted_issue_ids'].sort
    refute_includes json['deleted_issue_ids'], outside_child.id
    assert_nil Issue.find_by(id: outside_child.id)
  end

  def test_physical_delete_overflow_invalidates_board_instead_of_returning_partial_delta
    status = IssueStatus.first
    parent = build_issue(subject: 'Overflow delete parent', status: status)
    child = build_issue(subject: 'Overflow delete child', parent_issue_id: parent.id, status: status)

    delete :destroy, params: {
      project_id: @project.identifier,
      id: parent.id,
      project_ids: [@project.id],
      scope_status_ids_present: '1',
      scope_status_ids: [status.id],
      board_entity_limit: 1,
      lock_version: parent.lock_version
    }

    assert_response :success
    json = JSON.parse(@response.body)
    assert_equal [], json['deleted_issue_ids']
    assert_equal true, json.dig('invalidations', 'board_snapshot')
    assert_nil Issue.find_by(id: parent.id)
    assert_nil Issue.find_by(id: child.id)
  end

  def test_physical_delete_response_overflow_invalidates_board_without_partial_tombstone
    previous = ENV['REDMINE_KANBAN_MAX_RESPONSE_BYTES']
    ENV['REDMINE_KANBAN_MAX_RESPONSE_BYTES'] = '1'
    issue = build_issue(subject: 'Physical delete response overflow')

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
    assert_equal [], json['deleted_issue_ids']
    assert_equal true, json.dig('invalidations', 'board_snapshot')
    assert_nil Issue.find_by(id: issue.id)
  ensure
    ENV['REDMINE_KANBAN_MAX_RESPONSE_BYTES'] = previous
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

  def build_issue(subject: 'Test issue', parent_issue_id: nil, status: nil, assigned_to: nil, author: @user, priority: nil, tracker: nil, project: @project)
    tracker ||= project.trackers.first || Tracker.first
    status ||= IssueStatus.first
    priority ||= IssuePriority.active.first
    issue = Issue.new(project: project, tracker: tracker, author: author, status: status, subject: subject, parent_issue_id: parent_issue_id, priority: priority, assigned_to: assigned_to)
    issue.save!
    Issue.find(issue.id)
  end

  def create_boundary_statuses
    position = IssueStatus.maximum(:position).to_i + 1
    [
      IssueStatus.create!(name: "Kanban boundary primary #{position}", is_closed: false, position: position),
      IssueStatus.create!(name: "Kanban boundary dependency #{position}", is_closed: true, position: position + 1)
    ]
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
