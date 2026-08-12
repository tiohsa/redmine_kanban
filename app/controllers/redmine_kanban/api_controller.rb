module RedmineKanban
  class ApiController < ApplicationController
    include ArrayParamNormalizer

    skip_before_action :authorize, only: [:move, :create, :update, :destroy, :bulk_create]

    before_action :find_issue, only: [:move, :update, :destroy]
    before_action :require_view_permission, only: [:index, :bootstrap, :entities, :counts, :trackers]
    before_action :require_move_permission, only: [:move]
    before_action :require_create_permission, only: [:create]
    before_action :require_create_permission, only: [:bulk_create]
    before_action :require_update_permission, only: [:update]
    before_action :require_delete_permission, only: [:destroy]
    before_action :validate_board_entity_limit, only: [:move, :create, :update, :destroy, :bulk_create]

    def index
      render_board_payload(board_payload)
    end

    def bootstrap
      payload = board_payload
      render_board_payload(payload)
    end

    def entities
      ids = normalize_integer_array_param(params[:ids])
      context = mutation_board_context
      member_ids = RedmineKanban::BoardMembershipResolver.new(board_context: context).member_ids(ids)
      issues = Issue.visible(User.current)
                     .where(id: member_ids.to_a, project_id: context.project_ids)
                     .includes(:assigned_to, :priority, :status, :project)
                     .to_a
      presenter = IssueEntityPresenter.new(user: User.current, board_project: @project)
      render json: {
        ok: true,
        contract_version: 3,
        scope_fingerprint: context.scope_fingerprint,
        scope_status_ids: context.scope_status_ids,
        dependency_status_ids: context.dependency_status_ids,
        entities: presenter.issues_to_h(issues),
        missing_issue_ids: ids - issues.map(&:id)
      }
    end

    def counts
      context = mutation_board_context
      statuses = IssueStatus.sorted.to_a
      counts = Issue.visible(User.current)
                    .where(project_id: context.project_ids, status_id: statuses.map(&:id))
                    .group(:status_id)
                    .count
      render json: {
        ok: true,
        contract_version: 3,
        scope_fingerprint: context.scope_fingerprint,
        columns: statuses.map { |status| { id: status.id, name: status.name, is_closed: status.is_closed, count: counts[status.id].to_i } }
      }
    end

    def trackers
      target_project_id = params[:target_project_id].to_i
      target_project = target_project_id.positive? ? Project.visible(User.current).find_by(id: target_project_id) : @project
      unless target_project && permission_policy.can_view_board?(@project)
        render json: { ok: false, message: I18n.t('redmine_kanban.error_permission_denied') }, status: :forbidden
        return
      end

      trackers = target_project.trackers.sorted.to_a
      available_project_ids_by_tracker = trackers.to_h { |tracker| [tracker.id, [target_project.id]] }
      metadata = TrackerMetadataBuilder.new(
        trackers: trackers,
        available_project_ids_by_tracker: available_project_ids_by_tracker,
      ).build

      render json: { ok: true, trackers: metadata }
    end

    def move
      payload = params[:issue] || params
      render_service_result(IssueMover.new(project: @project, issue: @issue, user: User.current, board_context: mutation_board_context, operation_id: payload[:operation_id]).move(
        status_id: payload[:status_id],
        assigned_to_id: payload[:assigned_to_id],
        priority_id: payload[:priority_id],
        assigned_to_provided: payload.key?(:assigned_to_id),
        priority_provided: payload.key?(:priority_id),
        lock_version: payload[:lock_version]
      ))
    end

    def create
      issue_params = params[:issue] || params
      render_service_result(IssueCreator.new(project: @project, user: User.current, board_context: mutation_board_context, operation_id: issue_params[:operation_id]).create(params: issue_params))
    end

    def bulk_create
      payload = params[:bulk] || params
      unless parameter_hash?(payload)
        render json: { ok: false, message: I18n.t('redmine_kanban.error_bulk_payload_invalid'), field_errors: { bulk: [I18n.t('redmine_kanban.error_hash_expected')] } }, status: :unprocessable_entity
        return
      end

      result = IssueCreator.new(project: @project, user: User.current, board_context: mutation_board_context, operation_id: payload[:operation_id]).create_with_subtasks(
        parent_params: payload[:parent] || {},
        subtasks: payload[:subtasks] || [],
        idempotency_key: request.headers['Idempotency-Key']
      )
      render_service_result(result)
    end

    def update
      payload = params[:issue] || params
      render_service_result(IssueUpdater.new(project: @project, user: User.current, board_context: mutation_board_context, operation_id: payload[:operation_id]).update(issue_id: @issue.id, params: payload))
    end

    def destroy
      lock_version = params.dig(:issue, :lock_version) || params[:lock_version]
      if lock_version.blank?
        render json: { ok: false, message: I18n.t('redmine_kanban.error_lock_version_required') }, status: :unprocessable_entity
        return
      end

      result = nil
      board_context = mutation_board_context
      membership_resolver = RedmineKanban::BoardMembershipResolver.new(board_context: board_context)
      deletion_candidate_ids = []
      deletion_delta_overflow = false
      deleted_parent_id = @issue.parent_id
      affected_ancestor_ids = @issue.ancestors.select { |ancestor| ancestor.visible?(User.current) }.map(&:id)
      Issue.transaction do
        locked_issue = Issue.lock.find_by(id: @issue.id)
        unless locked_issue && locked_issue.lock_version.to_i == lock_version.to_i
          result = { ok: false, message: I18n.t('redmine_kanban.error_conflict') }
          raise ActiveRecord::Rollback
        end

        unless permission_policy.can_delete_issue?(locked_issue, @project)
          result = { ok: false, message: I18n.t('redmine_kanban.error_permission_denied') }
          raise ActiveRecord::Rollback
        end

        candidate_result = membership_resolver.deletion_candidate_ids(
          [locked_issue.id],
          limit: board_context.effective_entity_limit
        )
        deletion_delta_overflow = candidate_result[:overflow]
        unless deletion_delta_overflow
          deletion_candidate_ids = Issue.lock
                                             .where(id: candidate_result[:ids])
                                             .order(id: :asc)
                                             .pluck(:id)
        end

        result = locked_issue.destroy ? { ok: true } : { ok: false, message: I18n.t('redmine_kanban.error_delete_failed') }
        raise ActiveRecord::Rollback unless result[:ok]

        unless deletion_delta_overflow
          surviving_ids = Issue.where(id: deletion_candidate_ids).pluck(:id)
          deletion_candidate_ids -= surviving_ids
        end
      end
      if result[:ok]
        operation_id = params[:operation_id] || params.dig(:issue, :operation_id)
        affected_ancestors = Issue.visible(User.current).where(id: affected_ancestor_ids).to_a
        result = MutationResultBuilder.new(board_context: board_context, operation_id: operation_id).build(
          deleted_issue_ids: deletion_delta_overflow ? [] : deletion_candidate_ids,
          issue_updates: affected_ancestors,
          invalidations: {
            issue_ids: affected_ancestor_ids,
            parent_ids: [deleted_parent_id].compact,
            column_counts: true,
            board_snapshot: deletion_delta_overflow
          }
        )
      end
      result = enforce_mutation_response_limit(result) if result[:ok]
      status = result[:ok] ? :ok : (result[:message] == I18n.t('redmine_kanban.error_permission_denied') ? :forbidden : :conflict)
      render json: result, status: status
    rescue ActiveRecord::StaleObjectError
      render json: { ok: false, message: I18n.t('redmine_kanban.error_conflict') }, status: :conflict
    end

    private

    def board_payload
      if legacy_pagination_param_present?
        return {
          ok: false,
          contract_version: 3,
          error: { code: 'BOARD_PAGINATION_UNSUPPORTED' },
          http_status: :bad_request
        }
      end

      BoardData.new(
        project: @project,
        user: User.current,
        project_ids: normalize_integer_array_param(params[:project_ids]),
        issue_status_ids: normalize_integer_array_param(params[:issue_status_ids]),
        exclude_status_ids: normalize_integer_array_param(params[:exclude_status_ids]),
        board_entity_limit: params[:board_entity_limit]
      ).to_h
    rescue SnapshotLimits::InvalidLimit => error
      {
        ok: false,
        contract_version: 3,
        error: { code: 'INVALID_BOARD_ENTITY_LIMIT', message: error.message },
        http_status: :bad_request
      }
    end

    def legacy_pagination_param_present?
      %w[offset cursor tree_parent_id issue_limit].any? { |key| params.key?(key) || params.key?(key.to_sym) }
    end

    def render_board_payload(payload)
      status = payload[:ok] == false ? (payload[:http_status] || :unprocessable_entity) : :ok
      render json: payload.except(:http_status), status: status
    end

    def mutation_board_context
      scope_status_ids = if scope_status_ids_present?
        normalize_integer_array_param(params[:scope_status_ids])
      end
      dependency_status_ids = if dependency_status_ids_present?
        normalize_integer_array_param(params[:dependency_status_ids])
      end
      BoardContext.new(
        project: @project,
        user: User.current,
        project_ids: normalize_integer_array_param(params[:project_ids]),
        scope_status_ids: scope_status_ids,
        dependency_status_ids: dependency_status_ids,
        board_entity_limit: params[:board_entity_limit]
      )
    end

    def scope_status_ids_present?
      %w[1 true].include?(params[:scope_status_ids_present].to_s.downcase)
    end

    def dependency_status_ids_present?
      %w[1 true].include?(params[:dependency_status_ids_present].to_s.downcase)
    end

    def require_move_permission
      return unless require_permission!(permission_policy.can_view_board?(@project))

      require_permission!(permission_policy.can_move_issue?(@issue, @project))
    end

    def require_view_permission
      require_permission!(permission_policy.can_view_board?(@project))
    end

    def require_create_permission
      target_project = target_project_for_create
      return unless require_permission!(target_project.present?)

      return unless require_permission!(permission_policy.can_view_board?(@project))

      require_permission!(permission_policy.can_create_issue?(target_project, @project))
    end

    def require_update_permission
      require_permission!(permission_policy.can_update_issue?(@issue, @project))
    end

    def require_delete_permission
      require_permission!(permission_policy.can_delete_issue?(@issue, @project))
    end

    def find_issue
      @issue = Issue.visible.find(params[:id])
    rescue ActiveRecord::RecordNotFound
      render_404
    end

    def target_project_for_create
      if params[:bulk].present? && !parameter_hash?(params[:bulk])
        return @project
      end

      bulk_parent = parameter_hash?(params[:bulk]) ? params[:bulk][:parent] : nil
      issue_params = params[:issue] || bulk_parent || {}
      return @project if params[:bulk].present? && !parameter_hash?(issue_params)
      return nil unless parameter_hash?(issue_params)

      parent_issue_id = issue_params[:parent_issue_id] || issue_params['parent_issue_id']
      if parent_issue_id.present?
        parent = Issue.visible(User.current).find_by(id: parent_issue_id)
        return parent&.project
      end
      target_project_id = issue_params[:project_id].to_i
      if target_project_id.positive?
        project = Project.visible(User.current).find_by(id: target_project_id)
        return project if project

        return nil
      end

      @project
    end

    def parameter_hash?(value)
      value.is_a?(Hash) || value.respond_to?(:to_unsafe_h)
    end

    def render_service_result(result)
      result = enforce_mutation_response_limit(result)
      if result[:ok]
        render json: result
      else
        render json: result, status: result[:http_status] || :unprocessable_entity
      end
    end

    def enforce_mutation_response_limit(result)
      return result unless result[:ok]
      return result if result.to_json.bytesize <= SnapshotLimits.response_bytes

      overflow = result.merge(
        issue_updates: [],
        created_issues: [],
        evicted_issue_ids: [],
        tree_changes: [],
        ancestor_updates: nil,
        invalidations: result.fetch(:invalidations, {}).merge(
          issue_ids: [],
          parent_ids: [],
          board_snapshot: true
        ),
        column_counts: {}
      )
      overflow.delete(:ancestor_updates)
      overflow.delete(:subtasks)
      overflow.delete(:issue) if overflow.to_json.bytesize > SnapshotLimits.response_bytes
      overflow
    end

    def validate_board_entity_limit
      SnapshotLimits.requested(params[:board_entity_limit]) if params.key?(:board_entity_limit) || params.key?('board_entity_limit')
    rescue SnapshotLimits::InvalidLimit => error
      render json: {
        ok: false,
        contract_version: 3,
        error: { code: 'INVALID_BOARD_ENTITY_LIMIT', message: error.message }
      }, status: :bad_request
    end

    def require_permission!(allowed)
      return true if allowed

      render json: { ok: false, message: I18n.t('redmine_kanban.error_permission_denied') }, status: :forbidden
      false
    end

    def permission_policy
      @permission_policy ||= PermissionPolicy.new(user: User.current)
    end
  end
end
