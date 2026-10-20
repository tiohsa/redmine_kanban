require 'set'

module RedmineKanban
  # Filter candidates are independent of board snapshot materialization. Keep
  # every relation bounded before materializing it so metadata can recover a
  # rejected snapshot without turning into an unbounded query.
  class BoardFilterOptionsBuilder
    HARD_MAX_FILTER_OPTION_ITEMS = 10_000

    class ResourceLimitExceeded < StandardError
      attr_reader :resource, :limit

      def initialize(resource:, limit:)
        @resource = resource
        @limit = limit
        super("Filter option resource #{resource} exceeds #{limit} items")
      end
    end

    def initialize(project_ids:, user:, limit: HARD_MAX_FILTER_OPTION_ITEMS)
      @project_ids = Array(project_ids).map(&:to_i).select(&:positive?).uniq
      @user = user
      @limit = [limit.to_i, HARD_MAX_FILTER_OPTION_ITEMS].min
    end

    def build
      {
        assignees: assignees,
        trackers: trackers,
        priorities: priorities,
      }
    end

    private

    def assignees
      visible_ids = visible_project_ids
      return [] if visible_ids.empty?

      projects = Project.where(id: visible_ids).to_a
      principals = Principal.member_of(projects).visible(@user)
      principals = principals.where(type: 'User') unless Setting.issue_group_assignment?
      if Setting.issue_group_assignment?
        built_in_group_ids = Group.where.not(id: Group.givable.select(:id)).select(:id)
        principals = principals.where.not(id: built_in_group_ids)
      end

      locked_users = User.where(status: User::STATUS_LOCKED)
        .where(id: Member.where(project_id: visible_ids).select(:user_id))
      principals = principals.where(id: principals.select(:id))
        .or(Principal.where(id: locked_users.select(:id)))

      candidate_ids = bounded_ids(principals.sorted, resource: 'assignees')
      return [] if candidate_ids.empty?

      rows = bounded_rows(
        Member.where(project_id: visible_ids, user_id: candidate_ids).distinct.order(:user_id, :project_id),
        columns: %i[user_id project_id], resource: 'assignees'
      )
      project_ids_by_principal = Hash.new { |hash, id| hash[id] = [] }
      rows.each { |principal_id, project_id| project_ids_by_principal[principal_id] << project_id }

      principals_by_id = Principal.where(id: candidate_ids).index_by(&:id)
      candidate_ids.filter_map do |id|
        principal = principals_by_id[id]
        next unless principal && project_ids_by_principal.key?(id)

        {
          id: id,
          name: principal.name,
          available_project_ids: project_ids_by_principal[id].uniq.sort,
        }
      end.sort_by { |option| [option[:name].downcase, option[:id]] }
    end

    def trackers
      visible_ids = visible_project_ids
      return [] if visible_ids.empty?

      relation = Tracker.visible(@user).joins(:projects).where(projects: { id: visible_ids }).order(:position, :id)
      rows = relation.distinct.limit(@limit + 1).pluck(:id, :name, :position, 'projects.id')
      ensure_count!(rows.length, resource: 'trackers')
      grouped = {}
      rows.each do |id, name, _position, project_id|
        option = grouped[id] ||= { id: id, name: name, available_project_ids: [] }
        option[:available_project_ids] << project_id
      end
      ensure_count!(grouped.length, resource: 'trackers')
      grouped.values.each { |option| option[:available_project_ids] = option[:available_project_ids].uniq.sort }
      grouped.values
    end

    def priorities
      rows = IssuePriority.active.sorted.limit(@limit + 1).to_a
      ensure_count!(rows.length, resource: 'priorities')
      rows.map { |priority| { id: priority.id, name: priority.name } }
    end

    def visible_project_ids
      @visible_project_ids ||= Project.visible(@user).active.where(id: @project_ids).pluck(:id)
    end

    def bounded_ids(relation, resource:)
      ids = relation.limit(@limit + 1).pluck(:id)
      ensure_count!(ids.length, resource: resource)
      ids
    end

    def bounded_rows(relation, columns: nil, resource:)
      rows = columns ? relation.limit(@limit + 1).pluck(*columns) : relation.limit(@limit + 1).to_a
      ensure_count!(rows.length, resource: resource)
      rows
    end

    def ensure_count!(count, resource:)
      raise ResourceLimitExceeded.new(resource: resource, limit: @limit) if count > @limit
    end
  end
end
