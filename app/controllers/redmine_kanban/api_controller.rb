module RedmineKanban
  class ApiController < ApplicationController
    include ArrayParamNormalizer

    skip_before_action :authorize, only: [:move, :create, :update, :destroy, :bulk_create]

    before_action :find_issue, only: [:move, :update, :destroy]
    before_action :require_view_permission, only: [:index, :bootstrap, :issues, :counts, :trackers]
    before_action :require_move_permission, only: [:move]
    before_action :require_create_permission, only: [:create]
    before_action :require_create_permission, only: [:bulk_create]
    before_action :require_update_permission, only: [:update]
    before_action :require_delete_permission, only: [:destroy]

    def index
      render json: board_payload
    end

    def bootstrap
      payload = board_payload
      render json: payload.except(:issues)
    end

    def issues
      payload = board_payload
      render json: {
        ok: payload[:ok],
        meta: payload[:meta],
        issues: payload[:issues]
      }
    end

    def counts
      payload = board_payload
      render json: {
        ok: payload[:ok],
        columns: payload[:columns],
        lanes: payload[:lanes]
      }
    end

    def trackers
      target_project_id = params[:target_project_id].to_i
      target_project = target_project_id.positive? ? Project.visible(User.current).find_by(id: target_project_id) : @project
      unless target_project && permission_policy.can_view_board?(@project)
        render json: { ok: false, message: '権限がありません' }, status: :forbidden
        return
      end

      render json: { ok: true, trackers: target_project.trackers.sorted.map { |tracker| { id: tracker.id, name: tracker.name } } }
    end

    def move
      payload = params[:issue] || params
      render_service_result(IssueMover.new(project: @project, issue: @issue, user: User.current, board_context: mutation_board_context).move(
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
      render_service_result(IssueCreator.new(project: @project, user: User.current, board_context: mutation_board_context).create(params: issue_params))
    end

    def bulk_create
      payload = params[:bulk] || params
      unless parameter_hash?(payload)
        render json: { ok: false, message: '一括作成payloadの形式が不正です', field_errors: { bulk: ['Hash形式で指定してください'] } }, status: :unprocessable_entity
        return
      end

      result = IssueCreator.new(project: @project, user: User.current, board_context: mutation_board_context).create_with_subtasks(
        parent_params: payload[:parent] || {},
        subtasks: payload[:subtasks] || [],
        idempotency_key: request.headers['Idempotency-Key']
      )
      render_service_result(result)
    end

    def update
      payload = params[:issue] || params
      render_service_result(IssueUpdater.new(project: @project, user: User.current, board_context: mutation_board_context).update(issue_id: @issue.id, params: payload))
    end

    def destroy
      lock_version = params.dig(:issue, :lock_version) || params[:lock_version]
      if lock_version.blank?
        render json: { ok: false, message: 'lock_versionが必要です' }, status: :unprocessable_entity
        return
      end

      result = nil
      Issue.transaction do
        locked_issue = Issue.lock.find_by(id: @issue.id)
        unless locked_issue && locked_issue.lock_version.to_i == lock_version.to_i
          result = { ok: false, message: '他ユーザにより更新されました' }
          raise ActiveRecord::Rollback
        end

        unless permission_policy.can_delete_issue?(locked_issue, @project)
          result = { ok: false, message: '権限がありません' }
          raise ActiveRecord::Rollback
        end

        result = locked_issue.destroy ? { ok: true } : { ok: false, message: '削除に失敗しました' }
        raise ActiveRecord::Rollback unless result[:ok]
      end
      render json: result, status: result[:ok] ? :ok : (result[:message].include?('権限') ? :forbidden : :conflict)
    rescue ActiveRecord::StaleObjectError
      render json: { ok: false, message: '他ユーザにより更新されました' }, status: :conflict
    end

    private

    def board_payload
      BoardData.new(
        project: @project,
        user: User.current,
        project_ids: normalize_integer_array_param(params[:project_ids]),
        issue_status_ids: normalize_integer_array_param(params[:issue_status_ids]),
        exclude_status_ids: normalize_integer_array_param(params[:exclude_status_ids]),
        issue_limit: params[:issue_limit],
        issue_offset: params[:offset],
        tree_parent_id: params[:tree_parent_id]
      ).to_h
    end

    def mutation_board_context
      BoardContext.new(
        project: @project,
        user: User.current,
        project_ids: normalize_integer_array_param(params[:project_ids])
      )
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
      if result[:ok]
        render json: result
      else
        render json: result, status: result[:http_status] || :unprocessable_entity
      end
    end

    def require_permission!(allowed)
      return true if allowed

      render json: { ok: false, message: '権限がありません' }, status: :forbidden
      false
    end

    def permission_policy
      @permission_policy ||= PermissionPolicy.new(user: User.current)
    end
  end
end
