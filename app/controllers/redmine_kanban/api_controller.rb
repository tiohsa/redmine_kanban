module RedmineKanban
  class ApiController < ApplicationController
    skip_before_action :authorize, only: [:update, :destroy]

    before_action :find_issue, only: [:move, :update, :destroy]
    before_action :require_move_permission, only: [:move]
    before_action :require_create_permission, only: [:create]
    before_action :require_update_permission, only: [:update]
    before_action :require_delete_permission, only: [:destroy]

    def index
      render json: BoardData.new(project: @project, user: User.current, project_ids: params[:project_ids]).to_h
    end

    def move
      payload = params[:issue] || params
      result = IssueMover.new(project: @project, issue: @issue, user: User.current).move(
        status_id: payload[:status_id],
        assigned_to_id: payload[:assigned_to_id],
        priority_id: payload[:priority_id],
        lock_version: payload[:lock_version]
      )

      if result[:ok]
        render json: result
      else
        render json: result, status: result[:http_status] || :unprocessable_entity
      end
    end

    def create
      issue_params = params[:issue] || params
      result = IssueCreator.new(project: @project, user: User.current).create(params: issue_params)

      if result[:ok]
        render json: result
      else
        render json: result, status: :unprocessable_entity
      end
    end

    def update
      payload = params[:issue] || params
      result = IssueUpdater.new(project: @project, user: User.current).update(issue_id: @issue.id, params: payload)

      if result[:ok]
        render json: result
      else
        status = result[:http_status] || :unprocessable_entity
        render json: result, status: status
      end
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
      return if User.current.allowed_to?(:manage_redmine_kanban, @project) && User.current.allowed_to?(:edit_issues, issue_project)

      render json: { ok: false, message: '権限がありません' }, status: :forbidden
    end

    def require_create_permission
      return if User.current.allowed_to?(:manage_redmine_kanban, @project) && User.current.allowed_to?(:add_issues, @project)

      render json: { ok: false, message: '権限がありません' }, status: :forbidden
    end

    def require_update_permission
      return if User.current.allowed_to?(:view_redmine_kanban, @project) && User.current.allowed_to?(:edit_issues, @project)

      render json: { ok: false, message: '権限がありません' }, status: :forbidden
    end

    def require_delete_permission
      return if User.current.allowed_to?(:view_redmine_kanban, @project) && User.current.allowed_to?(:delete_issues, @project)

      render json: { ok: false, message: '権限がありません' }, status: :forbidden
    end

    def find_issue
      @issue = Issue.visible.find(params[:id])
      render_404 unless @issue.project == @project || @issue.project.is_descendant_of?(@project)
    rescue ActiveRecord::RecordNotFound
      render_404
    end
  end
end
