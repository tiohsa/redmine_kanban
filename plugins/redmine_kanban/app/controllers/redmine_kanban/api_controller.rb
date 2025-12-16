module RedmineKanban
  class ApiController < ApplicationController
    skip_before_action :authorize, only: [:update, :destroy]

    before_action :require_move_permission, only: [:move]
    before_action :require_create_permission, only: [:create]
    before_action :require_update_permission, only: [:update]
    before_action :require_delete_permission, only: [:destroy]
    before_action :find_issue, only: [:move, :update, :destroy]

    def index
      render json: BoardData.new(project: @project, user: User.current).to_h
    end

    def move
      result = IssueMover.new(project: @project, issue: @issue, user: User.current).move(
        status_id: params[:status_id],
        assigned_to_id: params[:assigned_to_id]
      )

      if result[:ok]
        render json: result
      else
        render json: result, status: :unprocessable_entity
      end
    end

    def create
      result = IssueCreator.new(project: @project, user: User.current).create(params: params)

      if result[:ok]
        render json: result
      else
        render json: result, status: :unprocessable_entity
      end
    end

    def update
      result = IssueUpdater.new(project: @project, user: User.current).update(issue_id: @issue.id, params: params)

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
      return if User.current.allowed_to?(:manage_redmine_kanban, @project) && User.current.allowed_to?(:edit_issues, @project)

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
      render_404 unless @issue.project_id == @project.id
    rescue ActiveRecord::RecordNotFound
      render_404
    end
  end
end
