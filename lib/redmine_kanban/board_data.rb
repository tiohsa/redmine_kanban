require 'set'
require_relative 'board_context'

module RedmineKanban
  class BoardData
    DEFAULT_ISSUE_LIMIT = 500
    MAX_ISSUE_LIMIT = 1_000
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
      load_more_issues: "redmine_kanban.label_load_more_issues",
      load_more_failed: "redmine_kanban.label_load_more_failed",
      tree_truncated: "redmine_kanban.label_tree_truncated",
      tree_load_more: "redmine_kanban.label_tree_load_more",
      tree_refresh: "redmine_kanban.label_tree_refresh",
      no_result: "redmine_kanban.label_no_result",
      reset: "redmine_kanban.label_reset",
      undo: "redmine_kanban.label_undo",
      restoring: "redmine_kanban.label_restoring",
      bulk_subtask_title: "redmine_kanban.label_bulk_subtask_title",
      bulk_subtask_placeholder: "redmine_kanban.label_bulk_subtask_placeholder",
      bulk_subtask_help: "redmine_kanban.label_bulk_subtask_help",
      bulk_subtask_mode: "redmine_kanban.label_bulk_subtask_mode",
      bulk_subtask_table_mode: "redmine_kanban.label_bulk_subtask_table_mode",
      bulk_subtask_text_mode: "redmine_kanban.label_bulk_subtask_text_mode",
      creating: "redmine_kanban.label_creating",
      created: "redmine_kanban.label_created",
      saving: "redmine_kanban.label_saving",
      saved: "redmine_kanban.label_saved",
      save: "redmine_kanban.label_save",
      create: "redmine_kanban.label_create",
      create_issue: "redmine_kanban.label_create_issue",
      edit_issue: "redmine_kanban.label_edit_issue",
      save_comment: "redmine_kanban.label_save_comment",
      saving_comment: "redmine_kanban.label_saving_comment",
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
      help_load_more_issues: "redmine_kanban.label_help_load_more_issues",
      within_1_day: "redmine_kanban.label_within_1_day",
      within_specified_days: "redmine_kanban.label_within_specified_days",
      sort_by: "redmine_kanban.label_sort_by",
      display_settings: "redmine_kanban.label_display_settings",
      lane_type: "redmine_kanban.label_lane_type",
      none: "redmine_kanban.label_none",
      aging_warn_days: "redmine_kanban.label_aging_warn_days",
      aging_danger_days: "redmine_kanban.label_aging_danger_days",
      aging_exclude_closed: "redmine_kanban.label_aging_exclude_closed",
      show_subtasks_short: "redmine_kanban.label_show_subtasks_short",
      priority_lane_short: "redmine_kanban.label_priority_lane_short",
      viewable_projects_short: "redmine_kanban.label_viewable_projects_short",
      time_entry_short: "redmine_kanban.label_time_entry_short",
      display_width: "redmine_kanban.label_display_width",
      font_size: "redmine_kanban.label_font_size",
      scroll_top: "redmine_kanban.label_scroll_top",
      enable_time_entry_on_close: "redmine_kanban.label_enable_time_entry_on_close",
      disable_time_entry_on_close: "redmine_kanban.label_disable_time_entry_on_close",
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


    def initialize(project:, user:, project_ids: nil, issue_status_ids: nil, exclude_status_ids: nil, issue_limit: nil, issue_offset: nil, tree_parent_id: nil, tree_node_limit: BoardContext::DEFAULT_TREE_NODE_LIMIT)
      @project = project
      @user = user
      @board_context = BoardContext.new(
        project: @project,
        user: @user,
        project_ids: normalize_ids(project_ids),
        tree_node_limit: tree_node_limit
      )
      @project_ids = @board_context.project_ids
      @issue_status_ids = normalize_ids(issue_status_ids)
      @exclude_status_ids = normalize_ids(exclude_status_ids)
      @issue_limit = normalize_issue_limit(issue_limit)
      @issue_offset = normalize_issue_offset(issue_offset)
      @tree_parent_id = normalize_optional_id(tree_parent_id)
    end

    def to_h
      with_performance_metrics { build_payload }
    end

    private

    def with_performance_metrics
      return yield unless ENV['REDMINE_KANBAN_PERF_LOG'] == '1'

      started_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      sql_count = 0
      callback = lambda do |_name, _start, _finish, _id, payload|
        next if payload[:cached] || payload[:name] == 'SCHEMA'

        sql_count += 1
      end

      result = nil
      ActiveSupport::Notifications.subscribed(callback, 'sql.active_record') do
        result = yield
      end

      elapsed_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at) * 1000).round(1)
      Rails.logger.info(
        '[redmine_kanban] board_data_perf ' \
        "project_id=#{@project.id} sql_count=#{sql_count} " \
        "root_issue_count=#{result.dig(:meta, :tree, :root_issue_count)} " \
        "unique_node_count=#{result.dig(:meta, :tree, :unique_node_count)} " \
        "serialized_node_count=#{result.dig(:meta, :tree, :serialized_node_count)} " \
        "duplicate_node_count=#{result.dig(:meta, :tree, :duplicate_node_count)} " \
        "db_row_count=#{result.dig(:meta, :tree, :db_row_count)} " \
        "json_bytes=#{result.to_json.bytesize} elapsed_ms=#{elapsed_ms}"
      )
      result
    end

    def count_subtasks(issues)
      issues.sum { |issue| count_subtask_nodes(issue[:subtasks]) }
    end

    def count_subtask_nodes(subtasks)
      Array(subtasks).sum { |subtask| 1 + count_subtask_nodes(subtask[:subtasks]) }
    end

    def serialized_node_ids(issues)
      ids = []
      pending = Array(issues).reverse

      until pending.empty?
        node = pending.pop
        ids << node[:id]
        pending.concat(Array(node[:subtasks]).reverse)
      end

      ids
    end

    def build_payload
      statuses = IssueStatus.sorted.to_a
      columns = statuses.map do |s|
        { id: s.id, name: s.name, is_closed: s.is_closed }
      end

      status_ids = columns.map { |c| c[:id] }
      issues = fetch_issues(status_ids)
      total_issue_count = fetch_issues_total_count(status_ids)
      presenter, loader = @board_context.presenter(issues.map(&:id))
      nested_issue_ids = loader.loaded_issue_ids.to_set
      canonical_issues = issues.reject { |issue| nested_issue_ids.include?(issue.id) }
      serialized_issues = presenter.issues_to_h(canonical_issues)
      serialized_issue_ids = serialized_node_ids(serialized_issues)
      raw_node_ids = issues.map(&:id) + loader.loaded_issue_ids
      lane_assignee_ids = fetch_lane_assignee_ids(status_ids)
      lanes = build_lanes(lane_assignee_ids)

      counts = fetch_column_counts(status_ids)

      {
        ok: true,
        meta: {
          project_id: @project.id,
          project_ids: @project_ids,
          current_user_id: @user.id,
          can_move: permission_policy.can_move_issue?(@project),
          can_create: permission_policy.can_create_issue?(@project),
          can_delete: permission_policy.can_delete_issue?(@project),
          lane_type: 'assignee',
          pagination: {
            issue_limit: @issue_limit,
            offset: @issue_offset,
            issue_count: issues.size,
            total_issue_count: total_issue_count,
            next_offset: issues.size + @issue_offset,
            has_more_issues: @issue_offset + issues.size < total_issue_count,
            **(@tree_parent_id ? { tree_parent_id: @tree_parent_id } : {})
          },
          tree: {
            node_limit: @board_context.tree_node_limit,
            root_issue_count: canonical_issues.size,
            unique_node_count: serialized_issue_ids.uniq.size,
            serialized_node_count: serialized_issue_ids.size,
            duplicate_node_count: raw_node_ids.size - raw_node_ids.uniq.size,
            truncated: loader.truncated?,
            truncated_parent_ids: loader.truncated_parent_ids,
            loaded_node_count: loader.loaded_issue_ids.size,
            db_row_count: issues.size + loader.fetched_row_count
          }
        },
        columns: columns.map { |c| c.merge(count: counts[c[:id]].to_i) },
        lanes: lanes,
        lists: cached_lists,
        issues: serialized_issues,
        labels: cached_labels
      }
    end

    def permission_policy
      @permission_policy ||= PermissionPolicy.new(user: @user)
    end

    def fetch_issues(status_ids)
      relation = base_issue_scope(status_ids)
      relation = relation.where(status_id: filtered_status_ids(status_ids)) unless @tree_parent_id
      relation = relation.includes(:assigned_to, :priority, :status, :project)
      order = @tree_parent_id ? { lft: :asc, id: :asc } : { updated_on: :desc, id: :desc }
      relation.order(order).offset(@issue_offset).limit(@issue_limit).to_a
    end

    def fetch_issues_total_count(status_ids)
      relation = base_issue_scope(status_ids)
      relation = relation.where(status_id: filtered_status_ids(status_ids)) unless @tree_parent_id
      relation.count
    end

    def fetch_lane_assignee_ids(status_ids)
      base_issue_scope(status_ids)
        .order(updated_on: :desc)
        .limit(@issue_limit)
        .pluck(:assigned_to_id)
        .compact
        .uniq
    end

    def build_lanes(assigned_to_ids)
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
      relation = Issue.visible(@user).where(project_id: @project_ids, status_id: status_ids)
      return relation unless @tree_parent_id

      return Issue.none unless tree_parent_in_scope?

      relation.where(parent_id: @tree_parent_id)
    end

    def tree_parent_in_scope?
      @tree_parent_in_scope ||= Issue.visible(@user).where(id: @tree_parent_id, project_id: @project_ids).exists?
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

    def normalize_issue_limit(value)
      return DEFAULT_ISSUE_LIMIT unless value.to_i.positive?

      [value.to_i, MAX_ISSUE_LIMIT].min
    end

    def normalize_issue_offset(value)
      [value.to_i, 0].max
    end

    def normalize_optional_id(value)
      id = value.to_i
      id.positive? ? id : nil
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

    def lists_builder
      @lists_builder ||= BoardListsBuilder.new(project: @project, project_ids: @project_ids, user: @user)
    end

    def cached_lists
      Rails.cache.fetch(cache_key('lists'), expires_in: 60.seconds) { lists_builder.build }
    end

    def cached_labels
      Rails.cache.fetch(cache_key('labels'), expires_in: 60.seconds) { labels }
    end

    def cache_key(scope)
      [
        'redmine_kanban',
        scope,
        @project.id,
        @user.id,
        I18n.locale,
        @project_ids.sort.join('-')
      ].join(':')
    end
  end
end
