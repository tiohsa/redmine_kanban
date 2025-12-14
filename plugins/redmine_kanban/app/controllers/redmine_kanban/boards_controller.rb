module RedmineKanban
  class BoardsController < ApplicationController
    def show
      @settings = Setting.plugin_redmine_kanban || {}
    end
  end
end

