module RedmineKanban
  class KanbanController < ApplicationController
    menu_item :redmine_kanban

    def show
      @settings = Setting.plugin_redmine_kanban || {}
    end
  end
end

