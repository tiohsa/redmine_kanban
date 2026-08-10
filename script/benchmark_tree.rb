# frozen_string_literal: true

require 'json'

project_identifier = ENV.fetch('REDMINE_KANBAN_BENCHMARK_PROJECT', 'ecookbook')
project = Project.find_by(identifier: project_identifier)
raise "Project not found: #{project_identifier}" unless project

user_login = ENV['REDMINE_KANBAN_BENCHMARK_USER']
user = user_login.present? ? User.find_by(login: user_login) : User.where(admin: true).first
raise 'Benchmark user not found' unless user

entity_limit = ENV['REDMINE_KANBAN_BENCHMARK_ENTITY_LIMIT']
started_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)
result = RedmineKanban::BoardData.new(
  project: project,
  user: user,
  board_entity_limit: entity_limit
).to_h

elapsed_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at) * 1000).round(1)
meta = result[:meta] || {}
puts JSON.pretty_generate(
  entity_count: meta[:entity_count],
  id_probe_count: meta[:id_probe_count],
  materialized_row_count: meta[:materialized_row_count],
  sql_count: meta[:query_count],
  effective_entity_limit: meta[:effective_entity_limit],
  server_entity_limit: meta[:server_entity_limit],
  maximum_response_bytes: meta[:response_byte_limit],
  json_bytes: result.to_json.bytesize,
  elapsed_ms: elapsed_ms,
  complete: meta[:complete],
  error: result[:error]
)
