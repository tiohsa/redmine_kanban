module RedmineKanban
  class BoardData
    LABEL_TRANSLATION_KEYS = {
      all: "redmine_kanban.label_all",
      me: "redmine_kanban.label_me",
      unassigned: "redmine_kanban.label_unassigned",
      summary: "redmine_kanban.label_summary",
      analyzing: "redmine_kanban.label_analyzing",
      assignee: "redmine_kanban.label_assignee",
      search: "redmine_kanban.label_search",
      due: "redmine_kanban.label_due",
      sort: "redmine_kanban.label_sort",
      analyze: "redmine_kanban.label_analyze",
      normal_view: "redmine_kanban.label_normal_view",
      fullscreen_view: "redmine_kanban.label_fullscreen",
      add: "redmine_kanban.label_add",
      title_ai_analysis: "redmine_kanban.label_title_ai_analysis",
      close: "redmine_kanban.label_close",
      loading: "redmine_kanban.label_loading",
      fetching_data: "redmine_kanban.label_fetching_data",
      notice: "redmine_kanban.label_notice",
      updating: "redmine_kanban.label_updating",
      conflict: "redmine_kanban.label_conflict",
      error: "redmine_kanban.label_error",
      data_fetching: "redmine_kanban.label_data_fetching",
      delete_confirm_title: "redmine_kanban.label_delete_confirm_title",
      delete_confirm_message: "redmine_kanban.label_delete_confirm_message",
      deleting: "redmine_kanban.label_deleting",
      delete: "redmine_kanban.label_delete",
      cancel: "redmine_kanban.label_cancel",
      issue_subject: "redmine_kanban.label_issue_subject",
      issue_tracker: "redmine_kanban.label_issue_tracker",
      issue_assignee: "redmine_kanban.label_issue_assignee",
      issue_done_ratio: "redmine_kanban.label_issue_done_ratio",
      issue_due_date: "redmine_kanban.label_issue_due_date",
      issue_start_date: "redmine_kanban.label_issue_start_date",
      issue_priority: "redmine_kanban.label_issue_priority",
      issue_description: "redmine_kanban.label_issue_description",
      stagnation: "redmine_kanban.label_stagnation",
      not_set: "redmine_kanban.label_not_set",
      this_week: "redmine_kanban.label_this_week",
      within_3_days: "redmine_kanban.label_within_3_days",
      within_1_week: "redmine_kanban.label_within_1_week",
      overdue: "redmine_kanban.label_overdue",
      select_tracker: "redmine_kanban.label_select_tracker",
      invalid_assignee: "redmine_kanban.label_invalid_assignee",
      invalid_priority: "redmine_kanban.label_invalid_priority",
      update_failed: "redmine_kanban.label_update_failed",
      create_failed: "redmine_kanban.label_create_failed",
      delete_failed: "redmine_kanban.label_delete_failed",
      move_failed: "redmine_kanban.label_move_failed",
      load_failed: "redmine_kanban.label_load_failed",
      no_result: "redmine_kanban.label_no_result",
      reset: "redmine_kanban.label_reset",
      undo: "redmine_kanban.label_undo",
      restoring: "redmine_kanban.label_restoring",
      bulk_subtask_title: "redmine_kanban.label_bulk_subtask_title",
      bulk_subtask_placeholder: "redmine_kanban.label_bulk_subtask_placeholder",
      bulk_subtask_help: "redmine_kanban.label_bulk_subtask_help",
      creating: "redmine_kanban.label_creating",
      created: "redmine_kanban.label_created",
      saving: "redmine_kanban.label_saving",
      saved: "redmine_kanban.label_saved",
      save: "redmine_kanban.label_save",
      create: "redmine_kanban.label_create",
      show_subtasks: "redmine_kanban.label_show_subtasks",
      hide_subtasks: "redmine_kanban.label_hide_subtasks",
      board_aria: "redmine_kanban.label_board_aria",
      subtask_update_failed: "redmine_kanban.label_subtask_update_failed",
      restore_failed: "redmine_kanban.label_restore_failed",
      restore_error: "redmine_kanban.label_restore_error",
      updated: "redmine_kanban.label_updated",
      created_with_subtasks: "redmine_kanban.label_created_with_subtasks",
      updated_with_subtasks: "redmine_kanban.label_updated_with_subtasks",
      created_subtask_failed: "redmine_kanban.label_created_subtask_failed",
      updated_subtask_failed: "redmine_kanban.label_updated_subtask_failed",
      deleted_with_undo: "redmine_kanban.label_deleted_with_undo",
      url_clickable: "redmine_kanban.label_url_clickable",
      filter: "redmine_kanban.label_filter",
      filter_task: "redmine_kanban.label_filter_task",
      filter_subject: "redmine_kanban.label_filter_subject",
      project: "redmine_kanban.label_project",
      status: "redmine_kanban.label_status",
      fit_none: "redmine_kanban.label_fit_none",
      fit_width: "redmine_kanban.label_fit_width",
      fit_all: "redmine_kanban.label_fit_all",
      time_entry_permission_required: "redmine_kanban.label_time_entry_permission_required",
      show_priority_lanes: "redmine_kanban.label_show_priority_lanes",
      hide_priority_lanes: "redmine_kanban.label_hide_priority_lanes",
      issue_create_dialog_title: "redmine_kanban.label_issue_create_dialog_title",
      issue_edit_dialog_title: "redmine_kanban.label_issue_edit_dialog_title",
      issue_info_dialog_title: "redmine_kanban.label_issue_info_dialog_title",
      open_in_redmine: "redmine_kanban.label_open_in_redmine",
      show_viewable_projects: "redmine_kanban.label_show_viewable_projects",
      hide_viewable_projects: "redmine_kanban.label_hide_viewable_projects",
      help: "redmine_kanban.label_help",
      help_chapter1_title: "redmine_kanban.label_help_chapter1_title",
      help_chapter1_desc: "redmine_kanban.label_help_chapter1_desc",
      help_add: "redmine_kanban.label_help_add",
      help_filter: "redmine_kanban.label_help_filter",
      help_assignee: "redmine_kanban.label_help_assignee",
      help_project: "redmine_kanban.label_help_project",
      help_status: "redmine_kanban.label_help_status",
      help_priority: "redmine_kanban.label_help_priority",
      help_due: "redmine_kanban.label_help_due",
      help_sort: "redmine_kanban.label_help_sort",
      help_priority_lane: "redmine_kanban.label_help_priority_lane",
      help_time_entry: "redmine_kanban.label_help_time_entry",
      help_viewable_projects: "redmine_kanban.label_help_viewable_projects",
      help_fit_mode: "redmine_kanban.label_help_fit_mode",
      help_show_subtasks: "redmine_kanban.label_help_show_subtasks",
      help_fullscreen: "redmine_kanban.label_help_fullscreen",
      help_scroll_top: "redmine_kanban.label_help_scroll_top",
      help_font_size: "redmine_kanban.label_help_font_size",
      help_chapter2_title: "redmine_kanban.label_help_chapter2_title",
      help_drag_drop_title: "redmine_kanban.label_help_drag_drop_title",
      help_drag_drop_desc: "redmine_kanban.label_help_drag_drop_desc",
      help_edit_title: "redmine_kanban.label_help_edit_title",
      help_edit_desc: "redmine_kanban.label_help_edit_desc",
      help_quick_edit_title: "redmine_kanban.label_help_quick_edit_title",
      help_quick_edit_desc: "redmine_kanban.label_help_quick_edit_desc",
      help_subtask_title: "redmine_kanban.label_help_subtask_title",
      help_subtask_desc: "redmine_kanban.label_help_subtask_desc"
    }.freeze


    def initialize(project:, user:, project_ids: nil, issue_status_ids: nil, exclude_status_ids: nil)
      @project = project
      @user = user
      @settings = Settings.new(Setting.plugin_redmine_kanban)
      @project_catalog = ProjectCatalog.new(user: @user)
      @project_ids = sanitize_project_ids(normalize_ids(project_ids)).presence || [@project.id]
      @issue_status_ids = normalize_ids(issue_status_ids)
      @exclude_status_ids = normalize_ids(exclude_status_ids)
    end

    def to_h
      statuses = IssueStatus.sorted.to_a
      hidden_status_ids = default_hidden_status_ids(statuses) | @settings.hidden_status_ids
      columns = statuses.reject { |s| hidden_status_ids.include?(s.id) }.map do |s|
        { id: s.id, name: s.name, is_closed: s.is_closed }
      end

      status_ids = columns.map { |c| c[:id] }
      issues = fetch_issues(status_ids)
      lane_assignee_ids = @settings.lane_type == 'none' ? [] : fetch_lane_assignee_ids(status_ids)
      lanes = build_lanes(lane_assignee_ids)

      counts = fetch_column_counts(status_ids)
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
        lists: lists_builder.build,
        issues: issues.map { |issue| issue_presenter.issue_to_h(issue) },
        labels: labels
      }
    end

    private

    def default_hidden_status_ids(statuses)
      []
    end

    def fetch_issues(status_ids)
      relation = base_issue_scope(status_ids)
      relation = relation.where(status_id: filtered_status_ids(status_ids))
      relation = relation.includes(:assigned_to, :priority, :status, :project)
      relation.order(updated_on: :desc).limit(@settings.issue_limit).to_a
    end

    def fetch_lane_assignee_ids(status_ids)
      base_issue_scope(status_ids)
        .order(updated_on: :desc)
        .limit(@settings.issue_limit)
        .pluck(:assigned_to_id)
        .compact
        .uniq
    end

    def build_lanes(assigned_to_ids)
      return [{ id: 'none', name: l("redmine_kanban.label_all"), assigned_to_id: nil }] if @settings.lane_type == 'none'

      ids = assigned_to_ids.uniq
      users = User.where(id: ids).sorted.to_a
      lanes = [{ id: 'unassigned', name: l("redmine_kanban.label_unassigned"), assigned_to_id: nil }]
      lanes.concat(users.map { |u| { id: u.id, name: u.name, assigned_to_id: u.id } })
      lanes
    end

    def fetch_column_counts(status_ids)
      base_issue_scope(status_ids).group(:status_id).count
    end

    def base_issue_scope(status_ids)
      Issue.visible(@user).where(project_id: @project_ids, status_id: status_ids)
    end

    def filtered_status_ids(status_ids)
      ids = status_ids.uniq
      ids &= @issue_status_ids if @issue_status_ids.any?
      ids -= @exclude_status_ids if @exclude_status_ids.any?
      ids
    end

    def normalize_ids(values)
      Array(values).filter_map do |value|
        id = value.to_i
        id if id.positive?
      end.uniq
    end

    def sanitize_project_ids(ids)
      allowed_ids = @project_catalog.viewable_project_ids
      ids.select { |id| allowed_ids.include?(id) }
    end

    def labels
      LABEL_TRANSLATION_KEYS.transform_values { |translation_key| l(translation_key) }
    end

    def l(key, options = {})
      ::I18n.t(key, **options)
    end

    def issue_presenter
      @issue_presenter ||= BoardIssuePresenter.new(user: @user)
    end

    def lists_builder
      @lists_builder ||= BoardListsBuilder.new(project: @project, project_ids: @project_ids, user: @user)
    end
  end
end
