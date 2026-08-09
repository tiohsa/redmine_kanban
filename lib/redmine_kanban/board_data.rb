require 'set'
require 'json'
require_relative 'board_context'
require_relative 'board_workflow_status_resolver'
require_relative 'snapshot_limits'

module RedmineKanban
  class BoardData
    CONTRACT_VERSION = 3
    DEFAULT_BOARD_ENTITY_LIMIT = SnapshotLimits::DEFAULT_BOARD_ENTITY_LIMIT
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
      maximum_board_entity_count: "redmine_kanban.label_maximum_board_entity_count",
      maximum_board_entity_count_help: "redmine_kanban.label_maximum_board_entity_count_help",
      maximum_board_entity_count_invalid: "redmine_kanban.label_maximum_board_entity_count_invalid",
      server_entity_limit_notice: "redmine_kanban.label_server_entity_limit_notice",
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
      help_maximum_board_entity_count: "redmine_kanban.label_help_maximum_board_entity_count",
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


    def initialize(project:, user:, project_ids: nil, issue_status_ids: nil, exclude_status_ids: nil, board_entity_limit: nil)
      @project = project
      @user = user
      @requested_project_ids = normalize_ids(project_ids)
      @issue_status_ids = normalize_ids(issue_status_ids)
      @exclude_status_ids = normalize_ids(exclude_status_ids)
      @requested_entity_limit = SnapshotLimits.requested(board_entity_limit)
      @server_entity_limit = SnapshotLimits.server_entity_limit
      @effective_entity_limit = SnapshotLimits.effective(@requested_entity_limit)
      @response_byte_limit = SnapshotLimits.response_bytes
      @query_limit = SnapshotLimits.query_limit
    end

    def to_h
      with_performance_metrics { build_payload }
    end

    private

    def with_performance_metrics
      started_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      sql_count = 0
      snapshot_thread_id = Thread.current.object_id
      callback = lambda do |_name, _start, _finish, _id, payload|
        next if Thread.current.object_id != snapshot_thread_id || payload[:cached] || payload[:name] == 'SCHEMA' || !@count_snapshot_queries

        sql_count += 1
      end

      result = nil
      ActiveSupport::Notifications.subscribed(callback, 'sql.active_record') do
        prepare_context!
        result = yield
      end

      result[:meta][:query_count] = sql_count if result[:ok] && result[:meta]
      if sql_count > @query_limit && result[:ok]
        result = resource_error(
          'BOARD_QUERY_LIMIT_EXCEEDED',
          query_count: sql_count,
          maximum_queries: @query_limit
        )
      end

      if result[:ok]
        bytes = response_bytes_including_metadata(result)
        if bytes > @response_byte_limit
          result = resource_error(
            'BOARD_RESPONSE_TOO_LARGE',
            entity_count: result.dig(:meta, :entity_count),
            maximum_response_bytes: @response_byte_limit
          )
        else
          result[:meta][:response_bytes] = bytes
        end
      end

      elapsed_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at) * 1000).round(1)
      if ENV['REDMINE_KANBAN_PERF_LOG'] == '1'
      Rails.logger.info(
        '[redmine_kanban] board_data_perf ' \
        "project_id=#{@project.id} sql_count=#{sql_count} " \
        "entity_count=#{result.dig(:meta, :entity_count)} " \
        "id_probe_count=#{result.dig(:meta, :id_probe_count)} " \
        "materialized_row_count=#{result.dig(:meta, :materialized_row_count)} " \
        "json_bytes=#{result.to_json.bytesize} elapsed_ms=#{elapsed_ms}"
        )
      end
      result
    end

    def prepare_context!
      return if @board_context

      @board_context = BoardContext.new(
        project: @project,
        user: @user,
        project_ids: @requested_project_ids,
        issue_status_ids: @issue_status_ids,
        exclude_status_ids: @exclude_status_ids
      )
      @user.groups.load
      @user.builtin_role
      @project_ids = @board_context.project_ids
    end

    def response_bytes_including_metadata(result)
      previous_bytes = nil
      bytes = nil

      10.times do
        bytes = result.to_json.bytesize
        break if bytes == previous_bytes

        result[:meta][:response_bytes] = bytes
        previous_bytes = bytes
      end

      result.to_json.bytesize
    end

    def build_payload
      statuses = IssueStatus.sorted.to_a
      columns = statuses.map do |s|
        { id: s.id, name: s.name, is_closed: s.is_closed }
      end

      status_ids = columns.map { |c| c[:id] }
      @count_snapshot_queries = true
      begin
        issue_ids = fetch_issue_ids(@board_context.scope_status_ids)
        return too_large_error(issue_ids.size) if issue_ids.size > @effective_entity_limit

        issues = fetch_issues(issue_ids)
        presenter = IssueEntityPresenter.new(
          user: @user,
          board_project: @project,
          workflow_status_resolver: BoardWorkflowStatusResolver.new(user: @user, issues: issues),
          permission_policy: permission_policy
        )
        warm_permission_cache(issues)
        entities = presenter.issues_to_h(issues)
        tree = build_tree(issues)
        lane_assignee_ids = fetch_lane_assignee_ids(@board_context.scope_status_ids)
        lanes = build_lanes(lane_assignee_ids)

        counts = fetch_column_counts(status_ids)
        lists = without_snapshot_query_count { cached_lists }
        labels = without_snapshot_query_count { cached_labels }
      ensure
        @count_snapshot_queries = false
      end

      {
        ok: true,
        contract_version: CONTRACT_VERSION,
        scope_fingerprint: @board_context.scope_fingerprint,
        meta: {
          project_id: @project.id,
          project_ids: @project_ids,
          scope_status_ids: @board_context.scope_status_ids,
          scope_fingerprint: @board_context.scope_fingerprint,
          current_user_id: @user.id,
          can_move: permission_policy.can_move_issue?(@project),
          can_create: permission_policy.can_create_issue?(@project),
          can_delete: permission_policy.can_delete_issue?(@project),
          lane_type: 'assignee',
          complete: true,
          entity_count: entities.size,
          requested_entity_limit: @requested_entity_limit,
          effective_entity_limit: @effective_entity_limit,
          server_entity_limit: @server_entity_limit,
          response_byte_limit: @response_byte_limit,
          id_probe_count: issue_ids.size,
          materialized_row_count: issues.size
        },
        columns: columns.map { |c| c.merge(count: counts[c[:id]].to_i) },
        lanes: lanes,
        lists: lists,
        entities: entities,
        tree: tree,
        labels: labels
      }
    end

    def without_snapshot_query_count
      previous = @count_snapshot_queries
      @count_snapshot_queries = false
      yield
    ensure
      @count_snapshot_queries = previous
    end

    def warm_permission_cache(issues)
      without_snapshot_query_count do
        permission_policy.can_move_issue?(@project)
        permission_policy.can_create_issue?(@project)
        permission_policy.can_delete_issue?(@project)
        issues.each do |issue|
          permission_policy.can_log_time?(issue.project)
          permission_policy.can_move_issue?(issue, @project)
          permission_policy.can_update_issue?(issue, @project)
          permission_policy.can_delete_issue?(issue, @project)
        end
      end
    end

    def permission_policy
      @permission_policy ||= PermissionPolicy.new(user: @user)
    end

    def fetch_issue_ids(status_ids)
      base_issue_scope(status_ids)
        .order(updated_on: :desc, id: :desc)
        .limit(@effective_entity_limit + 1)
        .pluck(:id)
    end

    def fetch_issues(issue_ids)
      Issue.visible(@user)
           .where(id: issue_ids, project_id: @project_ids)
           .includes(:assigned_to, :author, :priority, :status, :project, :tracker)
           .order(updated_on: :desc, id: :desc)
           .to_a
    end

    def fetch_lane_assignee_ids(status_ids)
      base_issue_scope(status_ids)
        .order(updated_on: :desc)
        .limit(@effective_entity_limit)
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

    def too_large_error(count_at_least)
      resource_error(
        'BOARD_SCOPE_TOO_LARGE',
        requested_entity_limit: @requested_entity_limit,
        effective_entity_limit: @effective_entity_limit,
        server_entity_limit: @server_entity_limit,
        count_at_least: count_at_least
      )
    end

    def resource_error(code, **details)
      {
        ok: false,
        contract_version: CONTRACT_VERSION,
        scope_fingerprint: @board_context.scope_fingerprint,
        error: { code: code, **details }
      }
    end

    def build_tree(issues)
      issue_ids = issues.map(&:id).to_set
      children_by_parent_id = Hash.new { |hash, key| hash[key] = [] }
      roots = []
      parent_by_id = {}

      issues.each do |issue|
        parent_id = issue.parent_id.to_i if issue.parent_id.present?
        if parent_id && issue_ids.include?(parent_id) && parent_id != issue.id
          parent_by_id[issue.id] = parent_id
          children_by_parent_id[parent_id] << issue.id
        else
          roots << issue.id
        end
      end

      parent_by_id.to_a.each do |child_id, parent_id|
        seen = Set.new([child_id])
        current = parent_id
        while current
          if seen.include?(current)
            children_by_parent_id[parent_id].delete(child_id)
            parent_by_id.delete(child_id)
            roots << child_id
            break
          end
          seen.add(current)
          current = parent_by_id[current]
        end
      end

      issues_by_id = issues.index_by(&:id)
      children_by_parent_id.each_value do |ids|
        ids.sort_by! do |id|
          updated_on = issues_by_id.fetch(id).updated_on
          [updated_on ? -updated_on.to_i : 0, id]
        end
      end
      {
        root_ids: roots.uniq,
        children_by_parent_id: children_by_parent_id.each_with_object({}) { |(parent_id, child_ids), tree| tree[parent_id.to_s] = child_ids }
      }
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
