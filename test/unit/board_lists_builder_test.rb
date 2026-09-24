require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/board_lists_builder'

class RedmineKanbanBoardListsBuilderTest < ActiveSupport::TestCase
  fixtures :projects, :users, :roles, :members, :member_roles, :enabled_modules

  def test_assignees_match_redmine_and_use_one_user_query
    root = projects(:projects_001)
    project_ids = Project.order(:id).limit(4).pluck(:id)
    expected = Project.where(id: project_ids).to_a.flat_map { |project| project.assignable_users.to_a }
                      .uniq.sort_by { |user| user.name.to_s.downcase }.map(&:id)
    queries = []
    callback = lambda do |_name, _start, _finish, _id, payload|
      queries << payload[:sql] unless payload[:cached] || payload[:name] == 'SCHEMA'
    end

    actual = nil
    ActiveRecord::Base.connection.clear_query_cache
    ActiveSupport::Notifications.subscribed(callback, 'sql.active_record') do
      actual = RedmineKanban::BoardListsBuilder.new(project: root, project_ids: project_ids, user: users(:users_002)).send(:assignees_list)
    end

    assert_equal expected, actual.filter_map { |item| item[:id] }
    assert_equal 1, queries.count { |sql| sql.include?('JOIN `members`') || sql.include?('JOIN "members"') }
  end
end
