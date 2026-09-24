require 'set'

module RedmineKanban
  # Resolves workflow transitions for a complete board without repeating the
  # same role/workflow queries for every Issue Entity.
  class BoardWorkflowStatusResolver
    def initialize(user:, issues: [], statuses: nil)
      @user = user
      @statuses_by_id = statuses&.index_by(&:id)
      @roles_by_project_id = {}
      @group_ids = nil
      @transitions_by_key = {}
      @workflow_transitions = []
      @not_closable_ids = Set.new
      @not_reopenable_ids = Set.new
      preload_issue_constraints(issues)
      preload_workflow_transitions(issues)
    end

    def call(issue)
      return issue.new_statuses_allowed_to(@user) if issue.new_record? || issue.tracker_id_changed? || issue.status_id_changed?

      initial_status = issue.status_was
      tracker = issue.tracker
      return [] unless initial_status && tracker

      author_transition = issue.author_id == @user.id
      assignee_transition = issue.assigned_to_id.present? &&
        (@user.id == issue.assigned_to_id || group_ids.include?(issue.assigned_to_id))
      key = [issue.project_id, initial_status.id, tracker.id, author_transition, assignee_transition]
      statuses = transition_statuses(issue.project, initial_status, tracker, author_transition, assignee_transition, key).dup

      if @not_closable_ids.include?(issue.id)
        statuses.reject!(&:is_closed?)
      end
      if @not_reopenable_ids.include?(issue.id)
        statuses.select!(&:is_closed?)
      end

      statuses
    end

    private

    def transition_statuses(project, initial_status, tracker, author_transition, assignee_transition, key)
      @transitions_by_key[key] ||= begin
        role_ids = roles_for_workflow(project).map(&:id).to_set
        statuses = @workflow_transitions.filter_map do |transition|
          next unless transition.old_status_id == initial_status.id
          next unless transition.tracker_id == tracker.id
          next unless role_ids.include?(transition.role_id)
          next unless transition_allowed_for_actor?(transition, author_transition, assignee_transition)

          @statuses_by_id ? @statuses_by_id[transition.new_status_id] : transition.new_status
        end
        statuses.uniq.sort
      end
    end

    def roles_for_workflow(project)
      @roles_by_project_id[project.id] ||= begin
        roles = @user.admin? ? Role.all.to_a : @user.roles_for_project(project)
        roles.select(&:consider_workflow?)
      end
    end

    def preload_roles(project_by_id)
      return if project_by_id.empty?

      if @user.admin?
        roles = Role.all.to_a.select(&:consider_workflow?)
        project_by_id.each_key { |project_id| @roles_by_project_id[project_id] = roles }
        return
      end

      builtin_role = @user.builtin_role
      group_type = builtin_role.anonymous? ? 'GroupAnonymous' : 'GroupNonMember'
      members = Member.joins(:principal)
                      .where(project_id: project_by_id.keys)
                      .where('members.user_id = :user_id OR users.type = :group_type', user_id: @user.id, group_type: group_type)
                      .includes(:roles)
                      .to_a
      memberships = members.select { |member| member.user_id == @user.id }.index_by(&:project_id)
      override_members = members.reject { |member| member.user_id == @user.id }.index_by(&:project_id)

      project_by_id.each do |project_id, project|
        roles = if project.archived?
          []
        elsif membership = memberships[project_id]
          membership.roles.to_a
        elsif project.is_public?
          override_members[project_id]&.roles&.to_a || [builtin_role]
        else
          []
        end
        @roles_by_project_id[project_id] = roles.select(&:consider_workflow?)
      end
    end

    def group_ids
      @group_ids ||= @user.group_ids
    end

    def preload_issue_constraints(issues)
      issue_ids = Array(issues).map(&:id).uniq
      return if issue_ids.empty?

      @not_closable_ids.merge(blocked_issue_ids(issue_ids))
      @not_closable_ids.merge(open_descendant_owner_ids(issue_ids))
      @not_reopenable_ids.merge(closed_ancestor_owner_ids(issue_ids))
    end

    def preload_workflow_transitions(issues)
      issue_list = Array(issues)
      project_by_id = issue_list.to_h { |issue| [issue.project_id, issue.project] }
      preload_roles(project_by_id)

      role_ids = @roles_by_project_id.values.flatten.map(&:id).uniq
      old_status_ids = issue_list.map { |issue| issue.status_was&.id }.compact.uniq
      tracker_ids = issue_list.map(&:tracker_id).compact.uniq
      return if role_ids.empty? || old_status_ids.empty? || tracker_ids.empty?

      transitions = WorkflowTransition.where(old_status_id: old_status_ids, tracker_id: tracker_ids, role_id: role_ids)
      @workflow_transitions = (@statuses_by_id ? transitions : transitions.includes(:new_status)).to_a
    end

    def transition_allowed_for_actor?(transition, author, assignee)
      if author && assignee
        true
      elsif author || assignee
        transition.author == author || transition.assignee == assignee
      else
        !transition.author && !transition.assignee
      end
    end

    def blocked_issue_ids(issue_ids)
      IssueRelation
        .where(issue_to_id: issue_ids, relation_type: 'blocks')
        .joins(issue_from: :status)
        .where(issue_statuses: { is_closed: false })
        .distinct
        .pluck(:issue_to_id)
    end

    def open_descendant_owner_ids(issue_ids)
      Issue
        .joins("INNER JOIN issues AS board_ancestors ON board_ancestors.root_id = issues.root_id AND board_ancestors.lft < issues.lft AND board_ancestors.rgt > issues.rgt")
        .joins(:status)
        .where(board_ancestors: { id: issue_ids })
        .where(issue_statuses: { is_closed: false })
        .distinct
        .pluck('board_ancestors.id')
    end

    def closed_ancestor_owner_ids(issue_ids)
      Issue
        .joins("INNER JOIN issues AS board_descendants ON board_descendants.root_id = issues.root_id AND issues.lft < board_descendants.lft AND issues.rgt > board_descendants.rgt")
        .joins(:status)
        .where(board_descendants: { id: issue_ids })
        .where(issue_statuses: { is_closed: true })
        .distinct
        .pluck('board_descendants.id')
    end
  end
end
