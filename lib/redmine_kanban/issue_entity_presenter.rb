require_relative 'board_issue_presenter'

module RedmineKanban
  class IssueEntityPresenter
    def initialize(user:, board_project: nil, workflow_status_resolver: nil, permission_policy: nil)
      @presenter = BoardIssuePresenter.new(
        user: user,
        board_project: board_project,
        workflow_status_resolver: workflow_status_resolver,
        permission_policy: permission_policy
      )
    end

    def issue_to_h(issue)
      @presenter.issue_to_h(issue).tap { |payload| payload.delete(:subtasks) if payload }
    end

    def issues_to_h(issues)
      Array(issues).filter_map { |issue| issue_to_h(issue) }
    end
  end
end
