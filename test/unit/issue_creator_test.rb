require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/mutation_result_builder'
require_relative '../../lib/redmine_kanban/issue_creator'

class RedmineKanbanIssueCreatorTest < ActiveSupport::TestCase
  fixtures :projects, :users, :roles, :members, :member_roles, :enabled_modules, :issues, :issue_statuses, :trackers,
           :projects_trackers, :enumerations

  class CountingMutationResultBuilder < RedmineKanban::MutationResultBuilder
    attr_reader :build_count

    def initialize(**kwargs)
      @build_count = 0
      super
    end

    def build(**kwargs)
      @build_count += 1
      super(**kwargs)
    end
  end

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
  end

  def teardown
    Rails.cache = @previous_cache_store
    super
  end

  def test_single_create_builds_one_semantic_result
    creator, builder = issue_creator

    result = creator.create(params: issue_params(subject: 'single semantic create'))

    assert_equal true, result[:ok]
    assert_equal 1, builder.build_count
    assert Issue.find_by(subject: 'single semantic create')
  end

  def test_bulk_create_builds_one_semantic_result_after_all_rows_persist
    creator, builder = issue_creator
    subtasks = 50.times.map { |index| issue_params(subject: "bulk child #{index}") }

    result = creator.create_with_subtasks(
      parent_params: issue_params(subject: 'bulk semantic parent'),
      subtasks: subtasks,
      idempotency_key: 'bulk-semantic-result-once'
    )

    assert_equal true, result[:ok]
    assert_equal 1, builder.build_count
    assert_equal 1, Issue.where(subject: 'bulk semantic parent').count
    assert_equal 50, Issue.where("subject LIKE ?", 'bulk child %').count
  end

  def test_bulk_row_failure_rolls_back_without_building_a_semantic_result
    creator, builder = issue_creator
    subtasks = [
      issue_params(subject: 'rollback child 1'),
      issue_params(subject: 'rollback child 2', tracker_id: 99_999)
    ]

    result = creator.create_with_subtasks(
      parent_params: issue_params(subject: 'rollback parent'),
      subtasks: subtasks,
      idempotency_key: 'bulk-semantic-result-rollback'
    )

    assert_equal false, result[:ok]
    assert_equal 0, builder.build_count
    assert_nil Issue.find_by(subject: 'rollback parent')
    assert_nil Issue.find_by(subject: 'rollback child 1')
  end

  def test_single_create_rejects_a_parent_that_safe_attributes_discards
    parent = build_issue(subject: 'parent permission boundary')
    roles_with_permission = @user.roles_for_project(@project).select { |role| role.permissions.include?(:manage_subtasks) }
    @user.roles_for_project(@project).each { |role| role.remove_permission!(:manage_subtasks) }
    @user.reload
    creator, = issue_creator

    result = creator.create(params: issue_params(subject: 'discarded parent', parent_issue_id: parent.id, status_id: parent.status_id))

    assert_equal false, result[:ok]
    assert_equal 'PARENT_ISSUE_NOT_ALLOWED', result.dig(:error, :code)
    assert_nil Issue.find_by(subject: 'discarded parent')
  ensure
    roles_with_permission&.each { |role| role.add_permission!(:manage_subtasks) }
  end

  def test_single_create_rejects_a_status_that_safe_attributes_falls_back
    issue = build_issue(subject: 'status workflow probe')
    allowed_status_ids = issue.new_statuses_allowed_to(@user).map(&:id)
    denied_status = IssueStatus.where.not(id: allowed_status_ids).first
    skip 'fixture has no denied workflow status' unless denied_status
    creator, = issue_creator

    result = creator.create(params: issue_params(subject: 'discarded status', status_id: denied_status.id))

    assert_equal false, result[:ok]
    assert_equal 'WORKFLOW_TRANSITION_NOT_ALLOWED', result.dig(:error, :code)
    assert_nil Issue.find_by(subject: 'discarded status')
  end

  def test_bulk_status_semantic_failure_rolls_back_all_rows
    issue = build_issue(subject: 'bulk status workflow probe')
    allowed_status_ids = issue.new_statuses_allowed_to(@user).map(&:id)
    denied_status = IssueStatus.where.not(id: allowed_status_ids).first
    skip 'fixture has no denied workflow status' unless denied_status
    creator, builder = issue_creator

    result = creator.create_with_subtasks(
      parent_params: issue_params(subject: 'bulk semantic parent', status_id: issue.status_id),
      subtasks: [issue_params(subject: 'bulk discarded status', status_id: denied_status.id)],
      idempotency_key: 'bulk-status-semantic-failure'
    )

    assert_equal false, result[:ok]
    assert_equal 'WORKFLOW_TRANSITION_NOT_ALLOWED', result.dig(:error, :code)
    assert_equal 0, builder.build_count
    assert_nil Issue.find_by(subject: 'bulk semantic parent')
    assert_nil Issue.find_by(subject: 'bulk discarded status')
  end

  private

  def issue_creator
    creator = RedmineKanban::IssueCreator.new(project: @project, user: @user)
    builder = CountingMutationResultBuilder.new(board_context: creator.instance_variable_get(:@board_context))
    creator.stubs(:mutation_result_builder).returns(builder)
    [creator, builder]
  end

  def issue_params(subject:, tracker_id: nil, status_id: nil, priority_id: nil, parent_issue_id: nil)
    params = {
      subject: subject,
      tracker_id: tracker_id || @project.trackers.first.id,
      status_id: status_id || IssueStatus.first.id,
      priority_id: priority_id || IssuePriority.active.first.id
    }
    params[:parent_issue_id] = parent_issue_id unless parent_issue_id.nil?
    params
  end

  def build_issue(subject:)
    Issue.new(
      project: @project,
      tracker: @project.trackers.first,
      author: @user,
      status: IssueStatus.first,
      priority: IssuePriority.active.first,
      subject: subject
    ).tap(&:save!)
  end

  def enable_kanban_module!
    EnabledModule.find_or_create_by!(project_id: @project.id, name: 'redmine_kanban')
  end

  def grant_permissions!
    @role.add_permission!(:view_redmine_kanban) unless @role.permissions.include?(:view_redmine_kanban)
    @role.add_permission!(:manage_redmine_kanban) unless @role.permissions.include?(:manage_redmine_kanban)
    @role.add_permission!(:add_issues) unless @role.permissions.include?(:add_issues)
    @role.add_permission!(:edit_issues) unless @role.permissions.include?(:edit_issues)
    @role.add_permission!(:delete_issues) unless @role.permissions.include?(:delete_issues)
    @role.add_permission!(:manage_subtasks) unless @role.permissions.include?(:manage_subtasks)
  end

  def ensure_member!
    member = Member.find_by(project_id: @project.id, user_id: @user.id) || Member.create!(project: @project, user: @user, role_ids: [@role.id])
    MemberRole.create!(member_id: member.id, role_id: @role.id) unless member.roles.include?(@role)
  end
end
