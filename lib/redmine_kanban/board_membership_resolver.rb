require 'set'

module RedmineKanban
  class BoardMembershipResolver
    def initialize(board_context:)
      @context = board_context
    end

    def snapshot_issue_ids(limit:)
      primary_ids = primary_scope.order(updated_on: :desc, id: :desc).limit(limit + 1).pluck(:id)
      return { ids: [], count_at_least: primary_ids.size } if primary_ids.size > limit

      remaining = limit - primary_ids.size
      dependency_ids = if remaining.positive? && primary_ids.any?
        descendant_scope(primary_ids).where.not(id: primary_ids)
          .order(updated_on: :desc, id: :desc).limit(remaining + 1).distinct.pluck(:id)
      else
        []
      end
      return { ids: [], count_at_least: limit + 1 } if dependency_ids.size > remaining

      { ids: primary_ids + dependency_ids, count_at_least: nil }
    end

    def member_ids(issues_or_ids)
      ids = Array(issues_or_ids).filter_map do |value|
        id = value.is_a?(Numeric) ? value.to_i : (value.id if value.respond_to?(:id))
        id if id.present?
      end.uniq
      return Set.new if ids.empty?

      primary_ids = primary_scope.where(id: ids).pluck(:id)
      dependency_ids = descendant_scope_for_candidates(ids).pluck(:id)
      Set.new(primary_ids + dependency_ids)
    end

    private

    def primary_scope
      visible_scope.where(status_id: @context.scope_status_ids)
    end

    def dependency_scope
      visible_scope.where(status_id: @context.dependency_status_ids)
    end

    def visible_scope
      Issue.visible(@context.user).where(project_id: @context.project_ids)
    end

    def descendant_scope(primary_ids)
      dependency_scope.joins(<<~SQL.squish)
        INNER JOIN issues board_primary_ancestors
          ON board_primary_ancestors.id IN (#{primary_ids.map(&:to_i).join(',')})
         AND board_primary_ancestors.lft < issues.lft
         AND board_primary_ancestors.rgt > issues.rgt
      SQL
    end

    def descendant_scope_for_candidates(candidate_ids)
      return Issue.none if @context.scope_status_ids.empty? || @context.dependency_status_ids.empty?

      dependency_scope.where(id: candidate_ids).joins(<<~SQL.squish)
        INNER JOIN issues board_primary_ancestors
          ON board_primary_ancestors.project_id IN (#{@context.project_ids.map(&:to_i).join(',')})
         AND board_primary_ancestors.status_id IN (#{@context.scope_status_ids.map(&:to_i).join(',')})
         AND board_primary_ancestors.lft < issues.lft
         AND board_primary_ancestors.rgt > issues.rgt
      SQL
        .distinct
    end
  end
end
