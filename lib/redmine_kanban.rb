require 'redmine'

module RedmineKanban
  PLUGIN_ID = 'redmine_kanban'.freeze
end

require_relative 'redmine_kanban/settings'
require_relative 'redmine_kanban/wip_checker'
require_relative 'redmine_kanban/board_data'
require_relative 'redmine_kanban/param_normalizer'
require_relative 'redmine_kanban/issue_mover'
require_relative 'redmine_kanban/issue_creator'
