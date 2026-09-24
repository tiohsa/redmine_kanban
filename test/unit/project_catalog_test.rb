require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/project_catalog'

class RedmineKanbanProjectCatalogTest < ActiveSupport::TestCase
  fixtures :projects, :users, :roles, :members, :member_roles, :enabled_modules

  def test_project_levels_are_batched_for_one_hundred_visible_projects
    root = projects(:projects_001)
    100.times do |index|
      Project.create!(name: "Kanban depth #{index}", identifier: "kanban-depth-#{index}", parent: root, is_public: true)
    end
    user = users(:users_001)
    queries = []
    callback = lambda do |_name, _start, _finish, _id, payload|
      queries << payload[:sql] unless payload[:cached] || payload[:name] == 'SCHEMA'
    end

    result = nil
    ActiveRecord::Base.connection.clear_query_cache
    ActiveSupport::Notifications.subscribed(callback, 'sql.active_record') do
      result = RedmineKanban::ProjectCatalog.new(user: user, board_project: root).viewable_projects
    end

    assert_equal 100, result.count { |item| item[:name].start_with?('Kanban depth ') }
    assert result.select { |item| item[:name].start_with?('Kanban depth ') }.all? { |item| item[:level] == 1 }
    assert_equal 1, queries.count { |sql| sql.include?('kanban_ancestors') }
  end

  def test_creatable_projects_match_redmine_permission_policy
    root = projects(:projects_001)
    user = users(:users_002)
    role = Role.find_by(name: 'Manager') || Role.givable.first || Role.first
    [:view_redmine_kanban, :manage_redmine_kanban, :add_issues].each { |permission| role.add_permission!(permission) }
    member = Member.find_by(project: root, user: user) || Member.create!(project: root, user: user, role_ids: [role.id])
    MemberRole.find_or_create_by!(member: member, role: role)
    EnabledModule.find_or_create_by!(project: root, name: 'redmine_kanban')
    direct_member = Project.create!(name: 'Kanban direct member', identifier: 'kanban-direct-member', parent: root, is_public: true)
    EnabledModule.create!(project: direct_member, name: 'redmine_kanban')
    Member.create!(project: direct_member, user: user, role_ids: [role.id])
    group_project = Project.create!(name: 'Kanban group override', identifier: 'kanban-group-override', parent: root, is_public: true)
    EnabledModule.create!(project: group_project, name: 'redmine_kanban')
    Member.create!(project: group_project, principal: GroupNonMember.first, role_ids: [role.id])
    user.reload
    expected = Project.visible(user).to_a.select(&:active?).filter_map do |project|
      project.id if RedmineKanban::PermissionPolicy.new(user: user).can_create_issue?(project, root)
    end.sort

    actual = RedmineKanban::ProjectCatalog.new(user: user, board_project: root).creatable_projects.map { |item| item[:id] }.sort

    assert_equal expected, actual
    assert_includes actual, direct_member.id
    assert_includes actual, group_project.id
  end
end
