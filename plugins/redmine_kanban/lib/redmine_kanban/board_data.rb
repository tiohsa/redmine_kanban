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
          can_delete: @user.allowed_to?(:delete_issues, @project),
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
        issues: issues.map { |issue| issue_to_h(issue) },
        labels: labels
      }
    end

    private

    def default_hidden_status_ids(statuses)
      []
    end

    def fetch_issues(status_ids)
      project_ids = @project.self_and_descendants.ids
      relation = Issue.visible(@user).where(project_id: project_ids).where(status_id: status_ids)
      relation = relation.includes(:assigned_to, :priority, :status)
      relation.order(updated_on: :desc).limit(@settings.issue_limit).to_a
    end

    def build_lanes(issues)
      return [{ id: 'none', name: l(:label_kanban_all), assigned_to_id: nil }] if @settings.lane_type == 'none'

      ids = issues.map(&:assigned_to_id).uniq.compact
      users = User.where(id: ids).sorted.to_a
      lanes = [{ id: 'unassigned', name: l(:label_kanban_unassigned), assigned_to_id: nil }]
      lanes.concat(users.map { |u| { id: u.id, name: u.name, assigned_to_id: u.id } })
      lanes
    end

    def assignees_list
      users = @project.assignable_users.sorted.to_a
      [{ id: nil, name: l(:label_kanban_unassigned) }] + users.map { |u| { id: u.id, name: u.name } }
    end

    def trackers_list
      trackers = @project.trackers.sorted.to_a
      trackers.map { |t| { id: t.id, name: t.name } }
    end

    def priorities_list
      IssuePriority.active.sorted.to_a.map { |p| { id: p.id, name: p.name } }
    end

    def fetch_column_counts(status_ids)
      project_ids = @project.self_and_descendants.ids
      Issue.visible(@user).where(project_id: project_ids, status_id: status_ids).group(:status_id).count
    end

    def issue_to_h(issue)
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
        start_date: issue.start_date&.to_s,
        due_date: issue.due_date&.to_s,
        priority_id: issue.priority_id,
        priority_name: issue.priority&.name,
        done_ratio: issue.done_ratio,
        updated_on: issue.updated_on&.iso8601,
        aging_days: aging_days(issue),
        urls: {
          issue: Rails.application.routes.url_helpers.issue_path(issue),
          issue_edit: Rails.application.routes.url_helpers.edit_issue_path(issue)
        }
      }
    end

    def aging_days(issue)
      return 0 unless issue.updated_on

      (Date.current - issue.updated_on.to_date).to_i
    end

    def labels
      {
        all: l(:label_kanban_all),
        me: l(:label_kanban_me),
        unassigned: l(:label_kanban_unassigned),
        summary: l(:label_kanban_summary),
        analyzing: l(:label_kanban_analyzing),
        assignee: l(:label_kanban_assignee),
        search: l(:label_kanban_search),
        due: l(:label_kanban_due),
        sort: l(:label_kanban_sort),
        analyze: l(:label_kanban_analyze),
        normal_view: l(:label_kanban_normal_view),
        fullscreen_view: l(:label_kanban_fullscreen),
        add: l(:label_kanban_add),
        title_ai_analysis: l(:label_kanban_title_ai_analysis),
        close: l(:label_kanban_close),
        loading: l(:label_kanban_loading),
        fetching_data: l(:label_kanban_fetching_data),
        notice: l(:label_kanban_notice),
        error: l(:label_kanban_error),
        data_fetching: l(:label_kanban_data_fetching),
        delete_confirm_title: l(:label_kanban_delete_confirm_title),
        delete_confirm_message: l(:label_kanban_delete_confirm_message),
        deleting: l(:label_kanban_deleting),
        delete: l(:label_kanban_delete),
        cancel: l(:label_kanban_cancel),
        issue_subject: l(:label_kanban_issue_subject),
        issue_tracker: l(:label_kanban_issue_tracker),
        issue_assignee: l(:label_kanban_issue_assignee),
        issue_done_ratio: l(:label_kanban_issue_done_ratio),
        issue_due_date: l(:label_kanban_issue_due_date),
        issue_start_date: l(:label_kanban_issue_start_date),
        issue_priority: l(:label_kanban_issue_priority),
        issue_description: l(:label_kanban_issue_description),
        stagnation: l(:label_kanban_stagnation),
        not_set: l(:label_kanban_not_set),
        this_week: l(:label_kanban_this_week),
        overdue: l(:label_kanban_overdue),
        select_tracker: l(:label_kanban_select_tracker),
        invalid_assignee: l(:label_kanban_invalid_assignee),
        invalid_priority: l(:label_kanban_invalid_priority),
        update_failed: l(:label_kanban_update_failed),
        create_failed: l(:label_kanban_create_failed),
        delete_failed: l(:label_kanban_delete_failed),
        move_failed: l(:label_kanban_move_failed),
        load_failed: l(:label_kanban_load_failed),
        no_result: l(:label_kanban_no_result)
      }
    end

    def l(key, options = {})
      ::I18n.t(key, **options)
    end
  end
end
