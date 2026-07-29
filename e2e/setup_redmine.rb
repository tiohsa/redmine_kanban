# frozen_string_literal: true

password = 'admin1234'

admin = User.find_by(login: 'admin') || User.where(admin: true).first
unless admin
  admin = User.new(
    login: 'admin',
    firstname: 'Admin',
    lastname: 'User',
    mail: 'admin@example.com',
    admin: true,
    language: 'en',
    status: User::STATUS_ACTIVE
  )
end

admin.password = password
admin.password_confirmation = password
admin.must_change_passwd = false if admin.respond_to?(:must_change_passwd=)
admin.save!

project = Project.find_or_initialize_by(identifier: 'ecookbook')
if project.new_record?
  project.name = 'eCookbook'
  project.is_public = true
  project.enabled_module_names = ['issue_tracking', 'redmine_kanban']
  project.save!
else
  names = project.enabled_module_names
  required_modules = ['issue_tracking', 'redmine_kanban']
  unless (required_modules - names).empty?
    project.enabled_module_names = names | required_modules
    project.save!
  end
end

tracker = Tracker.first
status = IssueStatus.first
raise 'tracker not found' unless tracker
raise 'issue status not found' unless status

project.trackers << tracker unless project.trackers.exists?(tracker.id)

parent_issue = Issue.find_or_create_by!(
  project: project,
  subject: 'Kanban E2E parent issue'
) do |issue|
  issue.author = admin
  issue.tracker = tracker
  issue.status = status
end

Issue.find_or_create_by!(
  project: project,
  subject: 'Kanban E2E nested child',
  parent: parent_issue
) do |issue|
  issue.author = admin
  issue.tracker = tracker
  issue.status = status
end

puts 'E2E seed setup completed'
