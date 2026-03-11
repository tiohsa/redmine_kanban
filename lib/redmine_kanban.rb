require 'redmine'

module RedmineKanban
  PLUGIN_ID = 'redmine_kanban'.freeze
end

require_relative 'redmine_kanban/settings'
require_relative 'redmine_kanban/wip_checker'
require_relative 'redmine_kanban/board_data'
require_relative 'redmine_kanban/board_issue_presenter'
require_relative 'redmine_kanban/board_lists_builder'
require_relative 'redmine_kanban/param_normalizer'
require_relative 'redmine_kanban/service_response'
require_relative 'redmine_kanban/issue_workflow'
require_relative 'redmine_kanban/issue_parent_attributes'
require_relative 'redmine_kanban/priority_propagation'
require_relative 'redmine_kanban/issue_mover'
require_relative 'redmine_kanban/issue_creator'
