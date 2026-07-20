Rails.application.routes.draw do
  get 'projects/:project_id/gantt', to: 'redmine_kanban/redirects#gantt'
  get 'projects/:project_id/kanban', to: 'redmine_kanban/kanban#show', as: 'redmine_kanban'

  scope 'projects/:project_id/kanban', module: 'redmine_kanban' do
    get 'data', to: 'api#index', as: 'redmine_kanban_data'
    get 'bootstrap', to: 'api#bootstrap', as: 'redmine_kanban_bootstrap'
    get 'issues', to: 'api#issues', as: 'redmine_kanban_issues'
    get 'counts', to: 'api#counts', as: 'redmine_kanban_counts'
    get 'trackers', to: 'api#trackers', as: 'redmine_kanban_trackers'
    patch 'issues/:id/move', to: 'api#move', as: 'redmine_kanban_move_issue'
    patch 'issues/:id', to: 'api#update', as: 'redmine_kanban_update_issue'
    delete 'issues/:id', to: 'api#destroy', as: 'redmine_kanban_delete_issue'
    post 'issues', to: 'api#create', as: 'redmine_kanban_create_issue'
  end
end
