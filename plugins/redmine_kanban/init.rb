require_relative 'lib/redmine_kanban'

Redmine::Plugin.register :redmine_kanban do
  name 'Redmine Kanban (SPA)'
  author 'redmine-kanban'
  description '運用強化向けのかんばん（WIP/停滞/Blocked）'
  version '0.1.0'
  url ''
  author_url ''

  project_module :redmine_kanban do
    permission :view_redmine_kanban, { 'redmine_kanban/boards': [:show], 'redmine_kanban/api': [:index] }, read: true
    permission :manage_redmine_kanban, { 'redmine_kanban/api': [:move, :create] }
  end

  menu :project_menu,
       :redmine_kanban,
       { controller: 'redmine_kanban/boards', action: 'show' },
       caption: 'かんばん',
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
             'blocked_bool_cf_id' => '',
             'blocked_reason_cf_id' => ''
           }
end
