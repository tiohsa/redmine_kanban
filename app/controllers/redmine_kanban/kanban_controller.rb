module RedmineKanban
  class KanbanController < ApplicationController
    menu_item :redmine_kanban

    def show
      @initial_labels = RedmineKanban::BoardData::LABEL_TRANSLATION_KEYS.transform_values { |key| I18n.t(key) }
    end
  end
end
