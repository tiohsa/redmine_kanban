module RedmineKanban
  class BoardData
    LABEL_TRANSLATION_KEYS = {
      all: :label_kanban_all,
      me: :label_kanban_me,
      unassigned: :label_kanban_unassigned,
      summary: :label_kanban_summary,
      analyzing: :label_kanban_analyzing,
      assignee: :label_kanban_assignee,
      search: :label_kanban_search,
      due: :label_kanban_due,
      sort: :label_kanban_sort,
      analyze: :label_kanban_analyze,
      normal_view: :label_kanban_normal_view,
      fullscreen_view: :label_kanban_fullscreen,
      add: :label_kanban_add,
      title_ai_analysis: :label_kanban_title_ai_analysis,
      close: :label_kanban_close,
      loading: :label_kanban_loading,
      fetching_data: :label_kanban_fetching_data,
      notice: :label_kanban_notice,
      updating: :label_kanban_updating,
      conflict: :label_kanban_conflict,
      error: :label_kanban_error,
      data_fetching: :label_kanban_data_fetching,
      delete_confirm_title: :label_kanban_delete_confirm_title,
      delete_confirm_message: :label_kanban_delete_confirm_message,
      deleting: :label_kanban_deleting,
      delete: :label_kanban_delete,
      cancel: :label_kanban_cancel,
      issue_subject: :label_kanban_issue_subject,
      issue_tracker: :label_kanban_issue_tracker,
      issue_assignee: :label_kanban_issue_assignee,
      issue_done_ratio: :label_kanban_issue_done_ratio,
      issue_due_date: :label_kanban_issue_due_date,
      issue_start_date: :label_kanban_issue_start_date,
      issue_priority: :label_kanban_issue_priority,
      issue_description: :label_kanban_issue_description,
      stagnation: :label_kanban_stagnation,
      not_set: :label_kanban_not_set,
      this_week: :label_kanban_this_week,
      within_3_days: :label_kanban_within_3_days,
      within_1_week: :label_kanban_within_1_week,
      overdue: :label_kanban_overdue,
      select_tracker: :label_kanban_select_tracker,
      invalid_assignee: :label_kanban_invalid_assignee,
      invalid_priority: :label_kanban_invalid_priority,
      update_failed: :label_kanban_update_failed,
      create_failed: :label_kanban_create_failed,
      delete_failed: :label_kanban_delete_failed,
      move_failed: :label_kanban_move_failed,
      load_failed: :label_kanban_load_failed,
      no_result: :label_kanban_no_result,
      reset: :label_kanban_reset,
      undo: :label_kanban_undo,
      restoring: :label_kanban_restoring,
      bulk_subtask_title: :label_kanban_bulk_subtask_title,
      bulk_subtask_placeholder: :label_kanban_bulk_subtask_placeholder,
      bulk_subtask_help: :label_kanban_bulk_subtask_help,
      creating: :label_kanban_creating,
      created: :label_kanban_created,
      saving: :label_kanban_saving,
      saved: :label_kanban_saved,
      save: :label_kanban_save,
      create: :label_kanban_create,
      show_subtasks: :label_kanban_show_subtasks,
      hide_subtasks: :label_kanban_hide_subtasks,
      board_aria: :label_kanban_board_aria,
      subtask_update_failed: :label_kanban_subtask_update_failed,
      restore_failed: :label_kanban_restore_failed,
      restore_error: :label_kanban_restore_error,
      updated: :label_kanban_updated,
      created_with_subtasks: :label_kanban_created_with_subtasks,
      updated_with_subtasks: :label_kanban_updated_with_subtasks,
      created_subtask_failed: :label_kanban_created_subtask_failed,
      updated_subtask_failed: :label_kanban_updated_subtask_failed,
      deleted_with_undo: :label_kanban_deleted_with_undo,
      url_clickable: :label_kanban_url_clickable,
      filter: :label_kanban_filter,
      filter_task: :label_kanban_filter_task,
      filter_subject: :label_kanban_filter_subject,
      project: :label_kanban_project,
      status: :label_kanban_status,
      fit_none: :label_kanban_fit_none,
      fit_width: :label_kanban_fit_width,
      fit_all: :label_kanban_fit_all,
      time_entry_permission_required: :label_kanban_time_entry_permission_required,
      show_priority_lanes: :label_kanban_show_priority_lanes,
      hide_priority_lanes: :label_kanban_hide_priority_lanes
    }.freeze

    def initialize(project:, user:, project_ids: nil)
      @project = project
      @user = user
      @settings = Settings.new(Setting.plugin_redmine_kanban)
      @project_ids = project_ids.presence || [@project.id]
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
          priorities: priorities_list,
          projects: projects_list
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
      relation = Issue.visible(@user).where(project_id: @project_ids).where(status_id: status_ids)
      relation = relation.includes(:assigned_to, :priority, :status, :project)
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

    def projects_list
      base_depth = @project.ancestors.count
      @project.self_and_descendants.visible.to_a.map do |p|
        { id: p.id, name: p.name, level: p.ancestors.count - base_depth }
      end
    end

    def assignees_list
      # Use assignable users from all selected projects
      projects = Project.where(id: @project_ids).to_a
      users = projects.map(&:assignable_users).flatten.uniq.sort_by { |u| u.name.to_s.downcase }
      [{ id: nil, name: l(:label_kanban_unassigned) }] + users.map { |u| { id: u.id, name: u.name } }
    end

    def trackers_list
      # Use trackers from all selected projects
      trackers = Project.where(id: @project_ids).includes(:trackers).flat_map(&:trackers).uniq.sort_by(&:position)
      trackers.map { |t| { id: t.id, name: t.name } }
    end

    def priorities_list
      IssuePriority.active.sorted.to_a.map { |p| { id: p.id, name: p.name } }
    end

    def fetch_column_counts(status_ids)
      Issue.visible(@user).where(project_id: @project_ids, status_id: status_ids).group(:status_id).count
    end

    def issue_to_h(issue)
      {
        id: issue.id,
        parent_id: issue.parent_id,
        subject: issue.subject,
        status_id: issue.status_id,
        can_log_time: @user.allowed_to?(:log_time, issue.project),
        lock_version: issue.lock_version,
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
        project: { id: issue.project_id, name: issue.project.name },
        subtasks: issue.children.visible.map { |child|
          {
            id: child.id,
            subject: child.subject,
            status_id: child.status_id,
            is_closed: child.status.is_closed?,
            lock_version: child.lock_version
          }
        },
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
      LABEL_TRANSLATION_KEYS.transform_values { |translation_key| l(translation_key) }
    end

    def l(key, options = {})
      ::I18n.t(key, **options)
    end
  end
end
