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
      snapshot_telemetry.measure do
        prepare_context!
        build_payload
      end
    end

    private

    def snapshot_telemetry
      @snapshot_telemetry ||= BoardSnapshotTelemetry.new(project: @project, context: -> { @board_context })
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

    def build_payload
      statuses = IssueStatus.sorted.to_a
      columns = statuses.map do |s|
        { id: s.id, name: s.name, is_closed: s.is_closed }
      end

      status_ids = columns.map { |c| c[:id] }
      snapshot_telemetry.snapshot_queries = true
      begin
        visible_scope = Issue.visible(@user)
        snapshot = BoardMembershipResolver.new(board_context: @board_context, visible_scope: visible_scope).snapshot_issue_ids(limit: @board_context.effective_entity_limit)
        return too_large_error(snapshot[:count_at_least]) if snapshot[:count_at_least]
        issue_ids = snapshot[:ids]

        issues = fetch_issues(issue_ids, statuses: statuses, visible_scope: visible_scope)
        presenter = IssueEntityPresenter.new(
          user: @user,
          board_project: @project,
          workflow_status_resolver: BoardWorkflowStatusResolver.new(user: @user, issues: issues, statuses: statuses),
          permission_policy: permission_policy
        )
        warm_permission_cache(issues)
        entities = presenter.issues_to_h(issues)
        tree = BoardTreeBuilder.new(issues).build
        lane_assignee_ids = issues.filter_map do |issue|
          issue.assigned_to_id if @board_context.scope_status_ids.include?(issue.status_id)
        end.uniq
        lanes = build_lanes(lane_assignee_ids)

        counts = if @board_context.scope_status_ids.sort == status_ids.sort
          issues.each_with_object(Hash.new(0)) { |issue, grouped| grouped[issue.status_id] += 1 }
        else
          fetch_column_counts(status_ids, visible_scope: visible_scope)
        end
        lists = snapshot_telemetry.with_metadata_queries { cached_lists }
        labels = snapshot_telemetry.with_metadata_queries { cached_labels }
      ensure
        snapshot_telemetry.snapshot_queries = false
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

    def warm_permission_cache(issues)
      snapshot_telemetry.without_snapshot_queries do
        ProjectCatalog.new(user: @user).with_preloaded_permission_context([@project, *issues.map(&:project)]) do
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
    end

    def permission_policy
      @permission_policy ||= PermissionPolicy.new(user: @user)
    end

    def fetch_issues(issue_ids, statuses:, visible_scope:)
      issues = visible_scope
                    .where(id: issue_ids, project_id: @project_ids)
                    .includes(:priority, { project: :enabled_modules }, :tracker, :category)
                    .order(updated_on: :desc, id: :desc)
                    .to_a
      statuses_by_id = statuses.index_by(&:id)
      principal_ids = issues.flat_map { |issue| [issue.assigned_to_id, issue.author_id] }.compact.uniq
      principals = Principal.where(id: principal_ids).index_by(&:id)
      issues.each do |issue|
        status_association = issue.association(:status)
        status_association.target = statuses_by_id[issue.status_id]
        status_association.loaded!
        { assigned_to: issue.assigned_to_id, author: issue.author_id }.each do |association_name, id|
          association = issue.association(association_name)
          target = principals[id]
          target = nil if association_name == :author && !target.is_a?(User)
          association.target = target
          association.loaded!
        end
      end
      issues
    end

    def build_lanes(assigned_to_ids)
      ids = assigned_to_ids.uniq
      users = User.where(id: ids).sorted.to_a
      lanes = [{ id: 'unassigned', name: l("redmine_kanban.label_unassigned"), assigned_to_id: nil }]
      lanes.concat(users.map { |u| { id: u.id, name: u.name, assigned_to_id: u.id } })
      lanes
    end

    def fetch_column_counts(status_ids, visible_scope:)
      visible_scope.where(project_id: @project_ids, status_id: status_ids).group(:status_id).count
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
