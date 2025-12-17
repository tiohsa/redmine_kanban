Rails.application.routes.draw do
  get 'projects/:project_id/gantt', to: 'redmine_kanban/redirects#gantt'
  get 'projects/:project_id/kanban', to: 'redmine_kanban/boards#show', as: 'redmine_kanban'

  scope 'projects/:project_id/kanban', module: 'redmine_kanban' do
    get 'data', to: 'api#index', as: 'redmine_kanban_data'
    patch 'issues/:id/move', to: 'api#move', as: 'redmine_kanban_move_issue'
    patch 'issues/:id', to: 'api#update', as: 'redmine_kanban_update_issue'
    delete 'issues/:id', to: 'api#destroy', as: 'redmine_kanban_delete_issue'
    post 'issues', to: 'api#create', as: 'redmine_kanban_create_issue'
    post 'analyze', to: 'ai_analysis#analyze', as: 'redmine_kanban_analyze'
  end
end
