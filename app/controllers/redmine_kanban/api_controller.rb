module RedmineKanban
  class ApiController < ApplicationController
    include ArrayParamNormalizer

    skip_before_action :authorize, only: [:move, :create, :update, :destroy]

    before_action :find_issue, only: [:move, :update, :destroy]
    before_action :require_move_permission, only: [:move]
    before_action :require_create_permission, only: [:create]
    before_action :require_update_permission, only: [:update]
    before_action :require_delete_permission, only: [:destroy]

    def index
      render json: BoardData.new(
        project: @project,
        user: User.current,
        project_ids: normalize_integer_array_param(params[:project_ids]),
        issue_status_ids: normalize_integer_array_param(params[:issue_status_ids]),
        exclude_status_ids: normalize_integer_array_param(params[:exclude_status_ids])
      ).to_h
    end

    def move
      payload = params[:issue] || params
      render_service_result(IssueMover.new(project: @project, issue: @issue, user: User.current).move(
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
      render_service_result(IssueCreator.new(project: @project, user: User.current).create(params: issue_params))
    end

    def update
      payload = params[:issue] || params
      render_service_result(IssueUpdater.new(project: @project, user: User.current).update(issue_id: @issue.id, params: payload))
    end

    def destroy
      if @issue.destroy
        render json: { ok: true }
      else
        render json: { ok: false, message: '削除に失敗しました' }, status: :unprocessable_entity
      end
    end

    private

    def require_move_permission
      issue_project = @issue.project
      require_permission!(
        User.current.allowed_to?(:manage_redmine_kanban, issue_project) && User.current.allowed_to?(:edit_issues, issue_project)
      )
    end

    def require_create_permission
      target_project = target_project_for_create
      require_permission!(target_project.present?)
      require_permission!(
        User.current.allowed_to?(:manage_redmine_kanban, target_project) && User.current.allowed_to?(:add_issues, target_project)
      )
    end

    def require_update_permission
      issue_project = @issue.project
      require_permission!(
        User.current.allowed_to?(:view_redmine_kanban, issue_project) && User.current.allowed_to?(:edit_issues, issue_project)
      )
    end

    def require_delete_permission
      issue_project = @issue.project
      require_permission!(
        User.current.allowed_to?(:view_redmine_kanban, issue_project) && User.current.allowed_to?(:delete_issues, issue_project)
      )
    end

    def find_issue
      @issue = Issue.visible.find(params[:id])
      render_404 unless User.current.allowed_to?(:view_redmine_kanban, @issue.project)
    rescue ActiveRecord::RecordNotFound
      render_404
    end

    def target_project_for_create
      issue_params = params[:issue] || {}
      target_project_id = issue_params[:project_id].to_i
      if target_project_id.positive?
        project = Project.visible(User.current).find_by(id: target_project_id)
        return project if project && User.current.allowed_to?(:view_redmine_kanban, project)

        return nil
      end

      @project
    end

    def render_service_result(result)
      if result[:ok]
        render json: result
      else
        render json: result, status: result[:http_status] || :unprocessable_entity
      end
    end

    def require_permission!(allowed)
      return if allowed

      render json: { ok: false, message: '権限がありません' }, status: :forbidden
    end
  end
end
