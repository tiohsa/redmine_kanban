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
# normal Issue page before they are folded into the parent tree, so making
# their timestamps equal to the seed time can push the parent out of the
# page on databases with coarse timestamp precision. Put all direct children
# safely before the parent, then make the parent the newest fixture row.
Issue.where(parent_id: parent_issue.id).update_all(updated_on: 1.day.ago)
parent_issue.update_column(:updated_on, Time.current + 1.hour)

puts 'E2E seed setup completed'
