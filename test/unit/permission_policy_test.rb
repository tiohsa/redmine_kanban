require 'minitest/autorun'
require_relative '../../lib/redmine_kanban/permission_policy'

class RedmineKanbanPermissionPolicyTest < Minitest::Test
  def setup
    @project = Object.new
  end

  def test_move_requires_manage_kanban_and_edit_issues
    assert_policy_allows(:can_move_issue?, :manage_redmine_kanban, :edit_issues)
  end

  def test_create_requires_manage_kanban_and_add_issues
    assert_policy_allows(:can_create_issue?, :manage_redmine_kanban, :add_issues)
  end

  def test_update_requires_view_kanban_and_edit_issues
    assert_policy_allows(:can_update_issue?, :view_redmine_kanban, :edit_issues)
  end

  def test_delete_requires_view_kanban_and_delete_issues
    assert_policy_allows(:can_delete_issue?, :view_redmine_kanban, :delete_issues)
  end

  def test_log_time_follows_redmine_log_time_permission
    assert RedmineKanban::PermissionPolicy.new(user: fake_user(:log_time)).can_log_time?(@project)
    refute RedmineKanban::PermissionPolicy.new(user: fake_user(:edit_issues)).can_log_time?(@project)
  end

  private

  def assert_policy_allows(method_name, first_permission, second_permission)
    assert policy_with(first_permission, second_permission).public_send(method_name, @project)
    refute policy_with(first_permission).public_send(method_name, @project)
    refute policy_with(second_permission).public_send(method_name, @project)
    refute policy_with.public_send(method_name, @project)
  end

  def policy_with(*permissions)
    RedmineKanban::PermissionPolicy.new(user: fake_user(*permissions))
  end

  def fake_user(*permissions)
    Object.new.tap do |user|
      user.define_singleton_method(:allowed_to?) do |permission, project|
        project && permissions.include?(permission)
      end
    end
  end
end
