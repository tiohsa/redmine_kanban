require 'json'
require_relative 'board_context'
require_relative 'board_workflow_status_resolver'
require_relative 'snapshot_limits'
require_relative 'board_membership_resolver'
require_relative 'board_labels'
require_relative 'board_tree_builder'

module RedmineKanban
  class BoardData
    CONTRACT_VERSION = 3
    DEFAULT_BOARD_ENTITY_LIMIT = SnapshotLimits::DEFAULT_BOARD_ENTITY_LIMIT
    LABEL_TRANSLATION_KEYS = BoardLabels::TRANSLATION_KEYS


    def initialize(project:, user:, project_ids: nil, issue_status_ids: nil, exclude_status_ids: nil, board_entity_limit: nil)
      @project = project
      @user = user
      @requested_project_ids = normalize_ids(project_ids)
      @issue_status_ids = normalize_ids(issue_status_ids)
      @exclude_status_ids = normalize_ids(exclude_status_ids)
      @board_entity_limit = board_entity_limit
    end

    def to_h
      with_performance_metrics { build_payload }
    end

    private

    def with_performance_metrics
      started_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      snapshot_query_count = 0
      metadata_query_count = 0
      total_query_count = 0
      snapshot_thread_id = Thread.current.object_id
      callback = lambda do |_name, _start, _finish, _id, payload|
        next if Thread.current.object_id != snapshot_thread_id || payload[:cached] || payload[:name] == 'SCHEMA'

        total_query_count += 1
        snapshot_query_count += 1 if @count_snapshot_queries
        metadata_query_count += 1 if @count_metadata_queries
      end

      result = nil
      ActiveSupport::Notifications.subscribed(callback, 'sql.active_record') do
        prepare_context!
        result = yield
      end

      result[:meta][:query_count] = snapshot_query_count if result[:ok] && result[:meta]
      if snapshot_query_count > @board_context.query_limit && result[:ok]
        result = resource_error(
          'BOARD_QUERY_LIMIT_EXCEEDED',
          query_count: snapshot_query_count,
          maximum_queries: @board_context.query_limit
        )
      end

      if result[:ok]
        bytes = response_bytes_including_metadata(result)
        if bytes > @board_context.response_byte_limit
          result = resource_error(
            'BOARD_RESPONSE_TOO_LARGE',
            entity_count: result.dig(:meta, :entity_count),
            maximum_response_bytes: @board_context.response_byte_limit
          )
        else
          result[:meta][:response_bytes] = bytes
        end
      end

      elapsed_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at) * 1000).round(1)
      if ENV['REDMINE_KANBAN_PERF_LOG'] == '1'
        Rails.logger.info(
          '[redmine_kanban] board_data_perf ' \
          "project_id=#{@project.id} sql_count=#{snapshot_query_count} " \
          "snapshot_query_count=#{snapshot_query_count} " \
          "metadata_query_count=#{metadata_query_count} " \
          "total_query_count=#{total_query_count} " \
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
        exclude_status_ids: @exclude_status_ids,
        board_entity_limit: @board_entity_limit
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
        snapshot = BoardMembershipResolver.new(board_context: @board_context).snapshot_issue_ids(limit: @board_context.effective_entity_limit)
        return too_large_error(snapshot[:count_at_least]) if snapshot[:count_at_least]
        issue_ids = snapshot[:ids]

        issues = fetch_issues(issue_ids)
        presenter = IssueEntityPresenter.new(
          user: @user,
          board_project: @project,
          workflow_status_resolver: BoardWorkflowStatusResolver.new(user: @user, issues: issues),
          permission_policy: permission_policy
        )
        warm_permission_cache(issues)
        entities = presenter.issues_to_h(issues)
        tree = BoardTreeBuilder.new(issues).build
        lane_assignee_ids = fetch_lane_assignee_ids(@board_context.scope_status_ids)
        lanes = build_lanes(lane_assignee_ids)

        counts = fetch_column_counts(status_ids)
        lists = with_metadata_query_count { without_snapshot_query_count { cached_lists } }
        labels = with_metadata_query_count { without_snapshot_query_count { cached_labels } }
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
          dependency_status_ids: @board_context.dependency_status_ids,
          scope_fingerprint: @board_context.scope_fingerprint,
          current_user_id: @user.id,
          can_move: permission_policy.can_move_issue?(@project),
          can_create: permission_policy.can_create_issue?(@project),
          can_delete: permission_policy.can_delete_issue?(@project),
          lane_type: 'assignee',
          complete: true,
          entity_count: entities.size,
          requested_entity_limit: @board_context.requested_entity_limit,
          effective_entity_limit: @board_context.effective_entity_limit,
          server_entity_limit: @board_context.server_entity_limit,
          response_byte_limit: @board_context.response_byte_limit,
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

    def with_metadata_query_count
      previous = @count_metadata_queries
      @count_metadata_queries = true
      yield
    ensure
      @count_metadata_queries = previous
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

    def fetch_issues(issue_ids)
      Issue.visible(@user)
           .where(id: issue_ids, project_id: @project_ids)
           .includes(:assigned_to, :author, :priority, :status, :project, :tracker, :category)
           .order(updated_on: :desc, id: :desc)
           .to_a
    end

    def fetch_lane_assignee_ids(status_ids)
      base_issue_scope(status_ids)
        .order(updated_on: :desc)
        .limit(@board_context.effective_entity_limit)
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
        requested_entity_limit: @board_context.requested_entity_limit,
        effective_entity_limit: @board_context.effective_entity_limit,
        server_entity_limit: @board_context.server_entity_limit,
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
      Rails.cache.fetch(cache_key('labels'), expires_in: 60.seconds) { BoardLabels.build }
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
