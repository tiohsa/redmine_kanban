require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/board_filter_options_builder'

class RedmineKanbanBoardFilterOptionsBuilderTest < ActiveSupport::TestCase
  fixtures :projects, :users, :roles, :members, :member_roles, :trackers, :projects_trackers, :enumerations

  def setup
    @project = projects(:projects_001)
    @second_project = Project.create!(name: 'Filter candidate second', identifier: 'filter-candidate-second', is_public: true)
    @hidden_project = Project.create!(name: 'Filter candidate hidden', identifier: 'filter-candidate-hidden', is_public: false)
    @user = users(:users_002)
    @candidate = User.create!(
      login: 'filter-candidate-user', firstname: 'Filter', lastname: 'Candidate',
      mail: 'filter-candidate@example.test', status: User::STATUS_ACTIVE,
      password: 'password123', password_confirmation: 'password123'
    )
    @second_candidate = User.create!(
      login: 'filter-candidate-second-user', firstname: 'Second', lastname: 'Candidate',
      mail: 'filter-candidate-second@example.test', status: User::STATUS_ACTIVE,
      password: 'password123', password_confirmation: 'password123'
    )
    @hidden_candidate = User.create!(
      login: 'filter-candidate-hidden-user', firstname: 'Hidden', lastname: 'Candidate',
      mail: 'filter-candidate-hidden@example.test', status: User::STATUS_ACTIVE,
      password: 'password123', password_confirmation: 'password123'
    )
    role = Role.find_by(name: 'Manager') || Role.givable.first || Role.first
    [@project, @second_project].each { |project| Member.create!(project: project, user: @candidate, roles: [role]) }
    Member.create!(project: @second_project, user: @second_candidate, roles: [role])
    Member.create!(project: @hidden_project, user: @hidden_candidate, roles: [role])
  end

  def test_assignees_include_visible_project_mapping_without_loading_issues
    Issue.expects(:visible).never

    options = build_options(projects: [@project, @second_project, @hidden_project]).fetch(:assignees)
    candidate = options.find { |option| option[:id] == @candidate.id }

    assert_equal [@project.id, @second_project.id].sort, candidate.fetch(:available_project_ids)
    refute_includes candidate.fetch(:available_project_ids), @hidden_project.id
    assert_equal [@second_project.id], options.find { |option| option[:id] == @second_candidate.id }.fetch(:available_project_ids)
    refute_includes options.map { |option| option[:id] }, @hidden_candidate.id
  end

  def test_tracker_candidates_come_from_project_configuration_even_without_issues
    tracker = Tracker.create!(name: 'Configured without issues', default_status: IssueStatus.first)
    @project.trackers << tracker
    Issue.expects(:visible).never

    options = build_options(projects: [@project]).fetch(:trackers)

    assert_includes options, { id: tracker.id, name: tracker.name, available_project_ids: [@project.id] }
  end

  def test_priorities_include_only_active_sorted_priorities
    active_sorted = IssuePriority.active.sorted.limit(20).pluck(:id)

    options = build_options(projects: [@project]).fetch(:priorities)

    assert_equal active_sorted, options.map { |option| option[:id] }
    assert_equal IssuePriority.active.sorted.pluck(:name), options.map { |option| option[:name] }
  end

  def test_candidate_overflow_returns_error_instead_of_a_partial_list
    assert_raises(RedmineKanban::BoardFilterOptionsBuilder::ResourceLimitExceeded) do
      builder(limit: 1).send(:assignees)
    end
  end

  def test_group_assignment_setting_controls_group_candidates
    role = Role.find_by(name: 'Manager') || Role.givable.first || Role.first
    group = Group.create!(lastname: 'Filter option group')
    Member.create!(project: @project, principal: group, roles: [role])
    built_in_group = GroupNonMember.first
    Member.create!(project: @project, principal: built_in_group, roles: [role])

    Setting.stubs(:issue_group_assignment?).returns(false)
    without_groups = builder(projects: [@project]).send(:assignees)
    refute_includes without_groups.map { |option| option[:id] }, group.id

    Setting.stubs(:issue_group_assignment?).returns(true)
    with_groups = builder(projects: [@project]).send(:assignees)
    assert_includes with_groups.map { |option| option[:id] }, group.id
    refute_includes with_groups.map { |option| option[:id] }, built_in_group.id
  end

  def test_tracker_candidate_overflow_raises_without_returning_partial_candidates
    assert_raises(RedmineKanban::BoardFilterOptionsBuilder::ResourceLimitExceeded) do
      builder(projects: [@project], limit: 1).send(:trackers)
    end
  end

  def test_priority_candidate_overflow_raises_without_returning_partial_candidates
    assert_raises(RedmineKanban::BoardFilterOptionsBuilder::ResourceLimitExceeded) do
      builder(projects: [@project], limit: 1).send(:priorities)
    end
  end

  def test_assignee_mapping_overflow_raises_without_returning_partial_candidates
    instance = builder(projects: [@project, @second_project], limit: 1)
    instance.stubs(:bounded_ids).returns([@candidate.id])

    assert_raises(RedmineKanban::BoardFilterOptionsBuilder::ResourceLimitExceeded) do
      instance.send(:assignees)
    end
  end

  private

  def build_options(projects:)
    builder(projects:).build
  end

  def builder(projects: [@project], limit: RedmineKanban::BoardFilterOptionsBuilder::HARD_MAX_FILTER_OPTION_ITEMS)
    RedmineKanban::BoardFilterOptionsBuilder.new(project_ids: projects.map(&:id), user: @user, limit: limit)
  end
end
