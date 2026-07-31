# frozen_string_literal: true

require 'json'

project_identifier = ENV.fetch('REDMINE_KANBAN_BENCHMARK_PROJECT', 'ecookbook')
project = Project.find_by(identifier: project_identifier)
raise "Project not found: #{project_identifier}" unless project

user_login = ENV['REDMINE_KANBAN_BENCHMARK_USER']
user = user_login.present? ? User.find_by(login: user_login) : User.where(admin: true).first
raise 'Benchmark user not found' unless user

issue_limit = ENV['REDMINE_KANBAN_BENCHMARK_ISSUE_LIMIT']
started_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)
sql_count = 0
callback = lambda do |_name, _start, _finish, _id, payload|
  next if payload[:cached] || payload[:name] == 'SCHEMA'

  sql_count += 1
end

result = nil
ActiveSupport::Notifications.subscribed(callback, 'sql.active_record') do
  result = RedmineKanban::BoardData.new(
    project: project,
    user: user,
    issue_limit: issue_limit
  ).to_h
end

elapsed_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at) * 1000).round(1)
tree = result.fetch(:meta).fetch(:tree)
puts JSON.pretty_generate(
  root_issue_count: tree[:root_issue_count],
  unique_node_count: tree[:unique_node_count],
  serialized_node_count: tree[:serialized_node_count],
  db_row_count: tree[:db_row_count],
  sql_count: sql_count,
  duplicate_node_count: tree[:duplicate_node_count],
  json_bytes: result.to_json.bytesize,
  elapsed_ms: elapsed_ms,
  node_limit: tree[:node_limit],
  truncated: tree[:truncated]
)
