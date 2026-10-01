require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/board_issue_filter'

class RedmineKanbanBoardIssueFilterTest < ActiveSupport::TestCase
  fixtures :projects, :users, :issues, :issue_statuses, :trackers, :enumerations

  def setup
    @project = projects(:projects_001)
    @user = users(:users_002)
    @tracker = @project.trackers.first || trackers(:trackers_001)
    @priority = IssuePriority.active.first
  end

  def test_canonicalizes_text_ids_and_irrelevant_fields
    filter = build(q: '  CaLendar  ', assignee_ids: %w[4 2 4], tracker_ids: %w[9 3], priority_ids: ['7'],
                   priority_filter_enabled: false, include_no_priority: true, due: 'all')

    assert_equal({
      q: 'calendar', assignee_ids: [2, 4], include_unassigned: false, tracker_ids: [3, 9],
      priority_filter_enabled: false, priority_ids: [], include_no_priority: false,
      due: 'all', due_days: nil, date_anchor: nil
    }, filter.scope)
  end

  def test_subject_search_escapes_sql_wildcards
    matching = create_issue('Calendar 50%_off!')
    near_miss = create_issue('Calendar 50X_off!')
    result = build(q: '  cALENDAR 50%_off! ').apply(Issue.where(id: [matching.id, near_miss.id])).pluck(:id)

    assert_equal [matching.id], result
  end

  def test_enabled_priority_with_empty_selection_and_no_null_match_is_empty
    filter = build(priority_filter_enabled: true, priority_ids: [], include_no_priority: false)

    assert_equal 0, filter.apply(Issue.all).count
  end

  def test_assignee_unassigned_tracker_and_priority_membership
    assignee = @user
    other_priority = IssuePriority.active.where.not(id: @priority.id).first
    skip 'requires two active priorities' unless other_priority
    assigned = create_issue('assigned', assigned_to_id: assignee.id, priority: other_priority)
    unassigned = create_issue('unassigned', assigned_to_id: nil, priority: other_priority)
    tracker = Tracker.create!(name: "Filter tracker #{SecureRandom.hex(4)}", default_status: IssueStatus.first)
    @project.trackers << tracker
    tracked = create_issue('tracked', tracker: tracker, priority: other_priority)
    prioritized = create_issue('prioritized', priority: @priority)
    ids = [assigned.id, unassigned.id, tracked.id, prioritized.id]

    assert_equal [assigned.id], build(assignee_ids: [assignee.id]).apply(Issue.where(id: ids)).pluck(:id)
    assert_equal [unassigned.id], build(include_unassigned: true).apply(Issue.where(id: [unassigned.id])).pluck(:id)
    assert_equal [tracked.id], build(tracker_ids: [tracker.id]).apply(Issue.where(id: ids)).pluck(:id)
    assert_equal [prioritized.id], build(priority_filter_enabled: true, priority_ids: [@priority.id]).apply(Issue.where(id: ids)).pluck(:id)
    synthetic_null_priority = Issue.from("(SELECT id, NULL AS priority_id FROM issues WHERE id = #{assigned.id}) AS issues")
    assert_equal [assigned.id], build(priority_filter_enabled: true, include_no_priority: true).apply(synthetic_null_priority).pluck(:id)
    priority_and_null = Issue.from("(SELECT id, priority_id FROM issues WHERE id = #{prioritized.id} UNION ALL SELECT id, NULL AS priority_id FROM issues WHERE id = #{assigned.id}) AS issues")
    assert_equal [prioritized.id, assigned.id].sort,
                 build(priority_filter_enabled: true, priority_ids: [@priority.id], include_no_priority: true).apply(priority_and_null).pluck(:id).sort
    assert_equal ids.sort, build(priority_filter_enabled: false, priority_ids: [@priority.id]).apply(Issue.where(id: ids)).pluck(:id).sort
  end

  def test_due_filter_builds_date_only_ranges
    anchor = Date.new(2026, 10, 1)
    {
      'overdue' => ['overdue', Date.new(2026, 9, 30)],
      'thisweek' => ['thisweek', Date.new(2026, 10, 5)],
      '1day' => ['1day', Date.new(2026, 10, 2)],
      '3days' => ['3days', Date.new(2026, 10, 4)],
      '7days' => ['7days', Date.new(2026, 10, 8)],
      'custom' => ['custom', Date.new(2026, 10, 6)]
    }.each do |mode, expected|
      filter = build(**{ due: mode, date_anchor: anchor.iso8601 }.merge(mode == 'custom' ? { due_days: 5 } : {}))
      due_dates = [Date.new(2026, 9, 30), anchor, Date.new(2026, 10, 2), Date.new(2026, 10, 3), Date.new(2026, 10, 5), Date.new(2026, 10, 7)]
      issues = due_dates.map { |date| create_issue("#{mode} #{date}", due_date: date) }
      actual = filter.apply(Issue.where(id: issues.map(&:id))).order(:due_date).pluck(:due_date)
      start_date = mode == 'thisweek' ? Date.new(2026, 9, 28) : (mode == 'overdue' ? nil : anchor)
      end_date = expected.last
      expected_dates = due_dates.select do |date|
        mode == 'overdue' ? date < anchor : date >= start_date && date < end_date
      end.sort
      assert_equal expected_dates, actual, "#{mode} date range"
    end
    missing_due = create_issue('none due', due_date: nil)
    assert_equal [missing_due.id], build(due: 'none').apply(Issue.where(id: missing_due.id)).pluck(:id)
    assert_equal Issue.all.to_sql, build(due: 'all').apply(Issue.all).to_sql
  end

  def test_matching_dependency_keeps_primary_ancestor_and_unmatched_tree_members
    primary_status = IssueStatus.sorted.first
    dependency_status = IssueStatus.sorted.where.not(id: primary_status.id).first || primary_status
    parent = create_issue('context parent', status: primary_status)
    child = create_issue('calendar issue child', status: dependency_status, parent_issue_id: parent.id)
    visible = Issue.where(project_id: @project.id)
    base = {
      project: @project, user: @user, project_ids: [@project.id],
      scope_status_ids: [primary_status.id], dependency_status_ids: IssueStatus.pluck(:id)
    }
    matching = RedmineKanban::BoardContext.new(**base, issue_filter: build(q: 'calendar issue'))
    excluded = RedmineKanban::BoardContext.new(**base, issue_filter: build(q: 'no matching issue'))
    unfiltered = RedmineKanban::BoardContext.new(**base)

    matching_ids = RedmineKanban::BoardMembershipResolver.new(board_context: matching, visible_scope: visible).snapshot_issue_ids(limit: 10)[:ids]
    excluded_ids = RedmineKanban::BoardMembershipResolver.new(board_context: excluded, visible_scope: visible).snapshot_issue_ids(limit: 10)[:ids]
    unfiltered_ids = RedmineKanban::BoardMembershipResolver.new(board_context: unfiltered, visible_scope: visible).snapshot_issue_ids(limit: 10)[:ids]

    assert_equal [parent.id, child.id].sort, matching_ids.sort
    assert_empty excluded_ids
    assert_includes unfiltered_ids, parent.id
    assert_includes unfiltered_ids, child.id
  end

  def test_rejects_invalid_ids_booleans_due_and_date_anchor
    [
      { assignee_ids: ['0'] }, { tracker_ids: ['x'] }, { include_unassigned: 'yes' },
      { due: 'soon' }, { due: 'all', due_days: 'bad' }, { due: 'all', date_anchor: 'bad' },
      { due: 'custom', due_days: '0', date_anchor: '2026-10-01' },
      { due: 'overdue', date_anchor: '2026-02-30' }, { due: 'overdue', date_anchor: nil }
    ].each { |input| assert_raises(RedmineKanban::BoardIssueFilter::InvalidFilter) { build(**input) } }
  end

  private

  def build(**values)
    RedmineKanban::BoardIssueFilter.new(values)
  end

  def create_issue(subject, assigned_to_id: nil, tracker: @tracker, priority: @priority, due_date: nil,
                   status: IssueStatus.first, parent_issue_id: nil)
    Issue.create!(project: @project, tracker: tracker, author: @user, assigned_to_id: assigned_to_id,
                  status: status, priority: priority, subject: subject, due_date: due_date, parent_issue_id: parent_issue_id)
  end
end
