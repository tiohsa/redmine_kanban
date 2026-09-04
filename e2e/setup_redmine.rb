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
required_modules = ['issue_tracking', 'time_tracking', 'redmine_kanban']
if project.new_record?
  project.name = 'eCookbook'
  project.is_public = true
end
project.enabled_module_names = project.enabled_module_names | required_modules
project.save!

tracker = Tracker.first
status = IssueStatus.first
raise 'tracker not found' unless tracker
raise 'issue status not found' unless status

project.trackers << tracker unless project.trackers.exists?(tracker.id)

native_project = Project.find_or_initialize_by(identifier: 'kanban-native')
native_project.name = 'Kanban Native E2E'
native_project.is_public = true
native_project.enabled_module_names = required_modules
native_project.save!
native_project.trackers << tracker unless native_project.trackers.exists?(tracker.id)

native_parent_issue = Issue.find_or_create_by!(
  project: native_project,
  subject: 'Kanban E2E parent issue'
) do |issue|
  issue.author = admin
  issue.tracker = tracker
  issue.status = status
end

Issue.find_or_create_by!(
  project: native_project,
  subject: 'Kanban E2E nested child',
  parent: native_parent_issue
) do |issue|
  issue.author = admin
  issue.tracker = tracker
  issue.status = status
end

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

if ENV['REDMINE_KANBAN_E2E_TREE_FIXTURE'] == '1'
  truncation_parent = Issue.find_or_initialize_by(
    project: project,
    subject: 'Kanban E2E truncation parent'
  )
  if truncation_parent.new_record?
    truncation_parent.author = admin
    truncation_parent.tracker = tracker
    truncation_parent.status = status
    truncation_parent.save!
  end

  target_child_count = 1_505
  existing_child_count = Issue.where(project: project, parent_id: truncation_parent.id)
                              .where('subject LIKE ?', 'Kanban E2E truncation child %')
                              .count
  (existing_child_count...target_child_count).each do |index|
    Issue.create!(
      project: project,
      parent: truncation_parent,
      subject: "Kanban E2E truncation child #{index + 1}",
      author: admin,
      tracker: tracker,
      status: status
    )
  end
  truncation_parent.update_column(:updated_on, Time.current)
end

# Keep the small mutation fixture on the first board page even when the
# optional high-fan-out fixture is enabled. Child Issues are part of the
# normal Issue page before they are folded into the parent tree, so normalize
# every fixture timestamp after seeding. This avoids relying on insertion
# timing or database timestamp precision to keep the parent ahead of the
# high-fan-out rows.
Issue.where(parent_id: parent_issue.id).update_all(updated_on: 1.day.ago)
if ENV['REDMINE_KANBAN_E2E_TREE_FIXTURE'] == '1'
  Issue.where(project: project, subject: 'Kanban E2E truncation parent')
       .update_all(updated_on: Time.current + 6.months)
  Issue.where(project: project)
       .where('subject LIKE ?', 'Kanban E2E truncation child %')
       .update_all(updated_on: 2.days.ago)
end
parent_issue.update_column(:updated_on, Time.current + 1.year)

puts 'E2E seed setup completed'
