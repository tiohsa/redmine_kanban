require_relative 'lib/redmine_kanban'

Redmine::Plugin.register :redmine_kanban do
  name 'Redmine Kanban'
  author 'tiohsa'
  description 'Redmine kanban'
  version '0.1.0'
  url 'https://github.com/tiohsa/redmine_kanban'
  author_url 'https://github.com/tiohsa'
  license 'GPL v2'

  project_module :redmine_kanban do
    permission :view_redmine_kanban, { 'redmine_kanban/kanban': [:show], 'redmine_kanban/api': [:index], 'redmine_kanban/ai_analysis': [:analyze] }, read: true
    permission :manage_redmine_kanban, { 'redmine_kanban/api': [:move, :create] }
  end

  menu :project_menu,
       :redmine_kanban,
       { controller: 'redmine_kanban/kanban', action: 'show' },
       caption: 'Kanban',
       after: :activity,
       param: :project_id

  settings partial: 'settings/redmine_kanban',
           default: {
             'lane_type' => 'assignee',
             'issue_limit' => 500,
             'hidden_status_ids' => [],
             'wip_limit_mode' => 'column',
             'wip_exceed_behavior' => 'block',
             'wip_limits' => {},
             'aging_warn_days' => 3,
             'aging_danger_days' => 7,
             'aging_exclude_closed' => '1',
             'status_auto_updates' => {}
           }
end
