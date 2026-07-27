require_relative 'lib/redmine_kanban'

Redmine::Plugin.register :redmine_kanban do
  name 'Redmine Kanban'
  author 'tiohsa'
  description 'Redmine kanban'
  version '0.3.1'
  url 'https://github.com/tiohsa/redmine_kanban'
  author_url 'https://github.com/tiohsa'
  project_module :redmine_kanban do
    permission :view_redmine_kanban, { 'redmine_kanban/kanban': [:show], 'redmine_kanban/api': [:index, :bootstrap, :issues, :counts, :trackers], 'redmine_kanban/ai_analysis': [:analyze] }, read: true, label: "redmine_kanban.permission_view"
    permission :manage_redmine_kanban, { 'redmine_kanban/api': [:move, :create, :update, :destroy, :bulk_create] }, label: "redmine_kanban.permission_manage"
  end

  menu :project_menu,
       :redmine_kanban,
       { controller: 'redmine_kanban/kanban', action: 'show' },
       caption: :"redmine_kanban.label_kanban",
       after: :activity,
       param: :project_id

end
