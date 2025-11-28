class GanttsController < ApplicationController

  
  before_action :find_project, only: [:index, :data]
  before_action :find_issue, only: [:update_issue]
  before_action :authorize_global, only: [:create_relation] # Simplified for now, should be project based usually

  def index
    # Renders index.html.erb
  end

  def data
    issues = @project.issues.visible.to_a
    issue_ids = issues.map(&:id)
    relations = IssueRelation.where(issue_from_id: issue_ids, issue_to_id: issue_ids)
    
    render json: {
      issues: issues.map { |i|
        {
          id: i.id,
          subject: i.subject,
          start_date: i.start_date,
          due_date: i.due_date,
          status: i.status.name,
          assigned_to: i.assigned_to&.name,
          done_ratio: i.done_ratio,
          estimated_hours: i.estimated_hours
        }
      },
      relations: relations.map { |r|
        {
          id: r.id,
          from: r.issue_from_id,
          to: r.issue_to_id,
          type: r.relation_type
        }
      }
    }
  end

  def update_issue
    @issue.init_journal(User.current)
    
    if params[:start_date]
      @issue.start_date = params[:start_date]
    end
    if params[:due_date]
      @issue.due_date = params[:due_date]
    end
    
    if @issue.save
      render json: { status: 'ok' }
    else
      render json: { status: 'error', errors: @issue.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def create_relation
    relation = IssueRelation.new
    relation.issue_from_id = params[:issue_from_id]
    relation.issue_to_id = params[:issue_to_id]
    relation.relation_type = IssueRelation::TYPE_PRECEDES
    
    if relation.save
      render json: { status: 'ok' }
    else
      render json: { status: 'error', errors: relation.errors.full_messages }, status: :unprocessable_entity
    end
  end

  private

  def find_project
    @project = Project.find(params[:project_id])
  rescue ActiveRecord::RecordNotFound
    render_404
  end

  def find_issue
    @issue = Issue.find(params[:id])
  rescue ActiveRecord::RecordNotFound
    render_404
  end
end
