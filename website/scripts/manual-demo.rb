# Run with rails runner in a disposable or development Redmine environment.
locale = ENV.fetch('MANUAL_CAPTURE_LOCALE', 'ja')
abort 'MANUAL_CAPTURE_LOCALE must be en or ja' unless %w[en ja].include?(locale)
japanese = locale == 'ja'

admin = User.find_by(login: 'admin')
admin.update!(language: locale)

project = Project.find_or_initialize_by(identifier: 'kanban-demo')
project.assign_attributes(
  name: japanese ? 'Webサイト公開プロジェクト' : 'Website Launch Project',
  description: japanese ? 'Redmine Kanban マニュアル撮影用デモプロジェクト' : 'Demo project for Redmine Kanban documentation captures',
  is_public: true,
  enabled_module_names: ['issue_tracking', 'time_tracking', 'redmine_kanban']
)
project.trackers = Tracker.all
project.save!

# Ensure roles have kanban permissions
Role.all.each do |role|
  perms = role.permissions.dup
  perms << :view_redmine_kanban unless perms.include?(:view_redmine_kanban)
  perms << :manage_redmine_kanban unless perms.include?(:manage_redmine_kanban)
  perms << :log_time unless perms.include?(:log_time)
  perms << :edit_issues unless perms.include?(:edit_issues)
  perms << :add_issues unless perms.include?(:add_issues)
  role.permissions = perms
  role.save!
end

# Categories
cat_names = japanese ? ['フロントエンド', 'バックエンド', 'インフラ'] : ['Frontend', 'Backend', 'Infrastructure']
categories = cat_names.map do |name|
  project.issue_categories.find_or_create_by!(name: name)
end

# Users
jsmith = User.find_by(login: 'jsmith') || admin
dlopper = User.find_by(login: 'dlopper') || admin

[admin, jsmith, dlopper].uniq.each do |u|
  member = Member.find_or_initialize_by(project: project, principal: u)
  member.roles = [Role.find_by(name: 'Manager') || Role.first]
  member.save!
end

# Clear existing demo issues in project
project.issues.destroy_all

status_new = IssueStatus.find_by(id: 1) || IssueStatus.first
status_in_progress = IssueStatus.find_by(id: 2) || IssueStatus.all[1] || status_new
status_resolved = IssueStatus.find_by(id: 3) || IssueStatus.all[2] || status_new
status_closed = IssueStatus.find_by(is_closed: true) || IssueStatus.last

priority_low = IssuePriority.find_by(name: 'Low') || IssuePriority.first
priority_normal = IssuePriority.find_by(name: 'Normal') || IssuePriority.default || IssuePriority.first
priority_high = IssuePriority.find_by(name: 'High') || IssuePriority.all[2] || priority_normal
priority_urgent = IssuePriority.find_by(name: 'Urgent') || IssuePriority.all[3] || priority_high

tracker_bug = Tracker.find_by(name: 'Bug') || Tracker.first
tracker_feature = Tracker.find_by(name: 'Feature request') || Tracker.all[1] || Tracker.first
tracker_support = Tracker.find_by(name: 'Support request') || Tracker.last

# Create sample issues
# 1. CI/CD pipeline (New, Normal, Infra)
i1 = project.issues.create!(
  subject: japanese ? 'CI/CD パイプラインの構築' : 'Setup CI/CD pipeline',
  description: japanese ? 'GitHub Actions による自動ビルドとテストを設定' : 'Configure automated build and test via GitHub Actions',
  tracker: tracker_feature,
  author: admin,
  assigned_to: admin,
  status: status_new,
  priority: priority_normal,
  category: categories[2],
  start_date: Date.today,
  due_date: Date.today + 7,
  done_ratio: 0
)

# 2. Design system (Parent, In Progress, Frontend)
i2 = project.issues.create!(
  subject: japanese ? 'デザインシステム策定' : 'Establish design system',
  description: japanese ? 'UI コンポーネントとカラーパレットの標準化' : 'Standardize UI components and color palette',
  tracker: tracker_feature,
  author: admin,
  assigned_to: jsmith,
  status: status_in_progress,
  priority: priority_high,
  category: categories[0],
  start_date: Date.today - 3,
  due_date: Date.today + 4,
  done_ratio: 50
)

# 2-1. Subtask: Color palette (Closed)
i2_1 = project.issues.create!(
  subject: japanese ? 'カラーパレットの定義' : 'Define color palette',
  tracker: tracker_feature,
  author: admin,
  assigned_to: jsmith,
  status: status_closed,
  priority: priority_normal,
  category: categories[0],
  parent_issue_id: i2.id,
  done_ratio: 100
)

# 2-2. Subtask: Typography (In Progress)
i2_2 = project.issues.create!(
  subject: japanese ? 'タイポグラフィ仕様の決定' : 'Define typography guidelines',
  tracker: tracker_feature,
  author: admin,
  assigned_to: jsmith,
  status: status_in_progress,
  priority: priority_normal,
  category: categories[0],
  parent_issue_id: i2.id,
  done_ratio: 20
)

# 3. OAuth authentication (In Progress, Urgent, Backend, Stalled / Aging)
i3 = project.issues.create!(
  subject: japanese ? 'OAuth 2.0 認証基盤の実装' : 'Implement OAuth 2.0 authentication',
  description: japanese ? 'Google / GitHub 連携ログイン機能の追加' : 'Add social login with Google and GitHub',
  tracker: tracker_feature,
  author: admin,
  assigned_to: dlopper,
  status: status_in_progress,
  priority: priority_urgent,
  category: categories[1],
  start_date: Date.today - 12,
  due_date: Date.today + 2,
  done_ratio: 30
)
# Force updated_on to 8 days ago for aging detection demonstration
i3.update_columns(updated_on: 8.days.ago)

# 4. Kanban drag-and-drop bug (Resolved, High, Frontend)
i4 = project.issues.create!(
  subject: japanese ? 'カンバン描画の境界判定を修正' : 'Fix Canvas board boundary calculation',
  description: japanese ? 'スクロール端でドラッグプレビューがずれる不具合を修正' : 'Fix drag preview offset near viewport boundaries',
  tracker: tracker_bug,
  author: admin,
  assigned_to: jsmith,
  status: status_resolved,
  priority: priority_high,
  category: categories[0],
  start_date: Date.today - 2,
  due_date: Date.today,
  done_ratio: 90
)

# 5. Database pool timeout (Resolved, High, Backend)
i5 = project.issues.create!(
  subject: japanese ? 'DB コネクションプールの設定見直し' : 'Tune database connection pool size',
  tracker: tracker_support,
  author: admin,
  assigned_to: dlopper,
  status: status_resolved,
  priority: priority_high,
  category: categories[1],
  done_ratio: 100
)

# 6. Kickoff meeting (Closed, Normal)
i6 = project.issues.create!(
  subject: japanese ? 'プロジェクトキックオフミーティング' : 'Project kickoff meeting',
  tracker: tracker_support,
  author: admin,
  assigned_to: admin,
  status: status_closed,
  priority: priority_normal,
  done_ratio: 100
)

puts "Successfully seeded demo project 'kanban-demo' with #{project.issues.count} issues in #{locale} locale."
