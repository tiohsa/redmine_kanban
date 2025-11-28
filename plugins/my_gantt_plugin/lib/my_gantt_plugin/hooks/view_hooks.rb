module MyGanttPlugin
  module Hooks
    class ViewHooks < Redmine::Hook::ViewListener
      def view_layouts_base_html_head(_context = {})
        javascript_include_tag('gantt_enhancements', plugin: 'my_gantt_plugin') +
          stylesheet_link_tag('gantt_enhancements', plugin: 'my_gantt_plugin')
      end
    end
  end
end
