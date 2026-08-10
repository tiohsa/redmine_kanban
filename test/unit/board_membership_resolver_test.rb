require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/board_membership_resolver'

class RedmineKanbanBoardMembershipResolverTest < ActiveSupport::TestCase
  FakePrimaryScope = Struct.new(:sql) do
    def select(*)
      self
    end

    def to_sql
      sql
    end
  end

  def setup
    @context = Struct.new(:user, :project_ids, :scope_status_ids, :dependency_status_ids).new(
      Object.new,
      [1],
      [2],
      [3]
    )
    @resolver = RedmineKanban::BoardMembershipResolver.new(board_context: @context)
  end

  def test_primary_ancestor_join_requires_same_root_and_nested_set_containment
    join = @resolver.send(
      :primary_ancestor_join,
      FakePrimaryScope.new('SELECT id, root_id, lft, rgt FROM issues')
    )

    assert_includes join, 'board_primary_ancestors.root_id = issues.root_id'
    assert_includes join, 'board_primary_ancestors.lft < issues.lft'
    assert_includes join, 'board_primary_ancestors.rgt > issues.rgt'
  end

  def test_primary_ancestor_join_uses_the_supplied_scope_without_status_sql_duplication
    join = @resolver.send(
      :primary_ancestor_join,
      FakePrimaryScope.new('SELECT id, root_id, lft, rgt FROM issues WHERE canonical_primary_scope')
    )

    assert_includes join, 'canonical_primary_scope'
    refute_includes join, 'status_id IN'
    refute_includes join, 'project_id IN'
  end
end
