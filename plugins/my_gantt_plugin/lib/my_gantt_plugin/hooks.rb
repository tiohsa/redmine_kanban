module MyGanttPlugin
  class Hooks < Redmine::Hook::ViewListener
    render_on :view_layouts_base_html_head, :partial => 'hooks/my_gantt_plugin/html_head'
  end
end
