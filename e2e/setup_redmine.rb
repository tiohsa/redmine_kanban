# frozen_string_literal: true

password = 'admin1234'

admin = User.find_by(login: 'admin')
raise 'admin user not found' unless admin

admin.password = password
admin.password_confirmation = password
admin.must_change_passwd = false if admin.respond_to?(:must_change_passwd=)
admin.save!

project = Project.find_or_initialize_by(identifier: 'ecookbook')
if project.new_record?
  project.name = 'eCookbook'
  project.is_public = true
  project.enabled_module_names = ['redmine_kanban']
  project.save!
else
  names = project.enabled_module_names
  unless names.include?('redmine_kanban')
    project.enabled_module_names = names + ['redmine_kanban']
    project.save!
  end
end

tracker = Tracker.first
status = IssueStatus.first
raise 'tracker not found' unless tracker
raise 'issue status not found' unless status

Issue.find_or_create_by!(
  project: project,
  subject: 'Kanban E2E seed issue'
) do |issue|
  issue.author = admin
  issue.tracker = tracker
  issue.status = status
end

puts 'E2E seed setup completed'
