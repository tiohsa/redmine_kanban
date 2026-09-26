module RedmineKanban
  class BoardEntityReader
    def initialize(board_context:, user:)
      @board_context = board_context
      @user = user
    end

    def read(ids:)
      member_ids = BoardMembershipResolver.new(board_context: @board_context).member_ids(ids)
      issues = Issue.visible(@user)
                    .where(id: member_ids.to_a, project_id: @board_context.project_ids)
                    .includes(:assigned_to, :priority, :status, :project)
                    .to_a
      presenter = IssueEntityPresenter.new(user: @user, board_project: @board_context.project)
      {
        ok: true,
        contract_version: 3,
        scope_fingerprint: @board_context.scope_fingerprint,
        scope_status_ids: @board_context.scope_status_ids,
        dependency_status_ids: @board_context.dependency_status_ids,
        entities: presenter.issues_to_h(issues),
        missing_issue_ids: ids - issues.map(&:id)
      }
    end
  end
end
