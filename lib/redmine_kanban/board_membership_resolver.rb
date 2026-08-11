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
      dependency_ids = if primary_ids.any?
        dependency_rows = descendant_scope(primary_ids).where.not(id: primary_ids)
          .select(:id, :updated_on)
          .distinct
          .order(updated_on: :desc, id: :desc)
          .limit(remaining + 1)
          .pluck(:id, :updated_on)
        dependency_rows.map(&:first)
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

    def primary_member?(issue_or_id)
      id = issue_or_id.is_a?(Numeric) ? issue_or_id.to_i : (issue_or_id.id if issue_or_id.respond_to?(:id))
      id.present? && primary_scope.where(id: id).exists?
    end

    def membership_candidate_ids(anchor_ids)
      ids = Array(anchor_ids).map(&:to_i).select(&:positive?).uniq
      return [] if ids.empty?

      descendant_scope_for_anchors(ids).distinct.pluck(:id)
    end

    def deletion_candidate_ids(anchor_ids, limit:)
      ids = Array(anchor_ids).map(&:to_i).select(&:positive?).uniq
      return { ids: [], overflow: false } if ids.empty?
      return { ids: ids, overflow: true } if ids.length > limit

      remaining = limit - ids.length
      if remaining.zero?
        has_descendants = descendant_scope_for_anchors(ids)
                              .where.not(id: ids)
                              .distinct
                              .limit(1)
                              .exists?
        return { ids: ids, overflow: has_descendants }
      end

      descendant_ids = descendant_scope_for_anchors(ids)
                        .where.not(id: ids)
                        .distinct
                        .order(id: :asc)
                        .limit(remaining + 1)
                        .pluck(:id)
      return { ids: ids, overflow: true } if descendant_ids.length > remaining

      { ids: ids + descendant_ids, overflow: false }
    end

    def membership_candidate_issues(ids)
      candidate_ids = Array(ids).map(&:to_i).select(&:positive?).uniq
      return [] if candidate_ids.empty?

      visible_scope.where(id: candidate_ids).to_a
    end

    private

    def primary_scope
      visible_scope.where(status_id: @context.scope_status_ids)
    end

    def dependency_scope
      visible_scope.where(status_id: @context.dependency_status_ids)
    end

    def visible_scope
      Issue.where(id: visible_issue_ids, project_id: @context.project_ids)
    end

    def visible_issue_ids
      Issue.visible(@context.user).select(:id)
    end

    def descendant_scope(primary_ids)
      dependency_scope.joins(primary_ancestor_join(primary_scope.where(id: primary_ids)))
    end

    def descendant_scope_for_candidates(candidate_ids)
      return Issue.none if @context.scope_status_ids.empty? || @context.dependency_status_ids.empty?

      dependency_scope.where(id: candidate_ids)
        .joins(primary_ancestor_join(primary_scope))
        .distinct
    end

    def descendant_scope_for_anchors(anchor_ids)
      anchor_scope = Issue.where(project_id: @context.project_ids, id: anchor_ids)
      dependency_scope.joins(primary_ancestor_join(anchor_scope))
    end

    def primary_ancestor_join(scope)
      <<~SQL.squish
        INNER JOIN (#{scope.select(:id, :root_id, :lft, :rgt).to_sql}) board_primary_ancestors
          ON board_primary_ancestors.root_id = issues.root_id
         AND board_primary_ancestors.lft < issues.lft
         AND board_primary_ancestors.rgt > issues.rgt
      SQL
    end
  end
end
