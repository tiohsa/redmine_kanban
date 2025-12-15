module RedmineKanban
  class BoardData
    def initialize(project:, user:)
      @project = project
      @user = user
      @settings = Settings.new(Setting.plugin_redmine_kanban)
    end

    def to_h
      statuses = IssueStatus.sorted.to_a
      hidden_status_ids = default_hidden_status_ids(statuses) | @settings.hidden_status_ids
      columns = statuses.reject { |s| hidden_status_ids.include?(s.id) }.map do |s|
        { id: s.id, name: s.name, is_closed: s.is_closed }
      end

      issues = fetch_issues(columns.map { |c| c[:id] })
      lanes = build_lanes(issues)

      counts = fetch_column_counts(columns.map { |c| c[:id] })
      wip_limits = @settings.wip_limits

      {
        ok: true,
        meta: {
          project_id: @project.id,
          current_user_id: @user.id,
          can_move: @user.allowed_to?(:manage_redmine_kanban, @project) && @user.allowed_to?(:edit_issues, @project),
          can_create: @user.allowed_to?(:manage_redmine_kanban, @project) && @user.allowed_to?(:add_issues, @project),
          can_delete: @user.allowed_to?(:manage_redmine_kanban, @project) && @user.allowed_to?(:delete_issues, @project),
          lane_type: @settings.lane_type,
          wip_limit_mode: @settings.wip_limit_mode,
          wip_exceed_behavior: @settings.wip_exceed_behavior,
          aging_warn_days: @settings.aging_warn_days,
          aging_danger_days: @settings.aging_danger_days,
          aging_exclude_closed: @settings.aging_exclude_closed?
        },
        columns: columns.map do |c|
          c.merge(
            wip_limit: (wip_limits[c[:id]] if wip_limits[c[:id]].to_i > 0),
            count: counts[c[:id]].to_i
          )
        end,
        lanes: lanes,
        lists: {
          assignees: assignees_list,
          trackers: trackers_list,
          priorities: priorities_list
        },
        issues: issues.map { |issue| issue_to_h(issue) }
      }
    end

    private

    def default_hidden_status_ids(statuses)
      return [] if @settings.hidden_status_ids.any?

      statuses.select(&:is_closed).map(&:id)
    end

    def fetch_issues(status_ids)
      relation = Issue.visible(@user).where(project_id: @project.id).where(status_id: status_ids)
      relation = relation.includes(:assigned_to, :priority, :status)
      relation.order(updated_on: :desc).limit(@settings.issue_limit).to_a
    end

    def build_lanes(issues)
      return [{ id: 'none', name: 'すべて', assigned_to_id: nil }] if @settings.lane_type == 'none'

      ids = issues.map(&:assigned_to_id).uniq.compact
      users = User.where(id: ids).sorted.to_a
      lanes = [{ id: 'unassigned', name: '未割当', assigned_to_id: nil }]
      lanes.concat(users.map { |u| { id: u.id, name: u.name, assigned_to_id: u.id } })
      lanes
    end

    def assignees_list
      users = @project.assignable_users.sorted.to_a
      [{ id: nil, name: '未割当' }] + users.map { |u| { id: u.id, name: u.name } }
    end

    def trackers_list
      trackers = @project.trackers.sorted.to_a
      trackers.map { |t| { id: t.id, name: t.name } }
    end

    def priorities_list
      IssuePriority.active.sorted.to_a.map { |p| { id: p.id, name: p.name } }
    end

    def fetch_column_counts(status_ids)
      Issue.visible(@user).where(project_id: @project.id, status_id: status_ids).group(:status_id).count
    end

    def issue_to_h(issue)
      blocked = blocked_state(issue)
      {
        id: issue.id,
        subject: issue.subject,
        status_id: issue.status_id,
        status_name: issue.status&.name,
        status_is_closed: issue.status&.is_closed,
        tracker_id: issue.tracker_id,
        description: issue.description,
        assigned_to_id: issue.assigned_to_id,
        assigned_to_name: issue.assigned_to&.name,
        due_date: issue.due_date&.to_s,
        priority_id: issue.priority_id,
        priority_name: issue.priority&.name,
        updated_on: issue.updated_on&.iso8601,
        aging_days: aging_days(issue),
        blocked: blocked[:blocked],
        blocked_reason: blocked[:reason],
        urls: {
          issue: Rails.application.routes.url_helpers.issue_path(issue)
        }
      }
    end

    def aging_days(issue)
      return 0 unless issue.updated_on

      (Date.current - issue.updated_on.to_date).to_i
    end

    def blocked_state(issue)
      bool_id = @settings.blocked_bool_cf_id
      reason_id = @settings.blocked_reason_cf_id
      return { blocked: false, reason: nil } if bool_id <= 0

      raw = issue.custom_field_value(bool_id).to_s
      blocked = %w[1 true yes].include?(raw.downcase)
      reason = (reason_id > 0 ? issue.custom_field_value(reason_id).to_s.strip : '')
      reason = nil if reason.empty?
      { blocked: blocked, reason: reason }
    end
  end
end
