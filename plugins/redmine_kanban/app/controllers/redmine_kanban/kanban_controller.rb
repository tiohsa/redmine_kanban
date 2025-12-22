module RedmineKanban
  class KanbanController < ApplicationController
    def show
      @settings = Setting.plugin_redmine_kanban || {}
    end
  end
end

