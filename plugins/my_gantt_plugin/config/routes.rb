# Plugin's routes
# See: http://guides.rubyonrails.org/routing.html

get 'projects/:project_id/gantts', to: 'gantts#index', as: 'project_gantts'
get 'projects/:project_id/gantts/data', to: 'gantts#data'
put 'gantts/:id/update_issue', to: 'gantts#update_issue'
post 'gantts/create_relation', to: 'gantts#create_relation'
