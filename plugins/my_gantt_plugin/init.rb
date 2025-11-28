Redmine::Plugin.register :my_gantt_plugin do
  name 'My Gantt Plugin plugin'
  author 'Author name'
  description 'Enhancements for Redmine Gantt view'
  version '0.1.0'
  url 'http://example.com/path/to/plugin'
  author_url 'http://example.com/about'
  menu :project_menu, :gantts, { controller: 'gantts', action: 'index' }, caption: 'Gantt', after: :activity, param: :project_id

  project_module :gantts do
    permission :view_gantts, gantts: [:index, :data]
    permission :manage_gantts, gantts: [:update_issue, :create_relation]
  end
end

Rails.application.config.to_prepare do
  require_dependency File.join(__dir__, 'lib', 'my_gantt_plugin', 'hooks', 'view_hooks')
end
