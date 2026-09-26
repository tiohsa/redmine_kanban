module RedmineKanban
  class BoardCountReader
    def initialize(board_context:, user:)
      @board_context = board_context
      @user = user
    end

    def read
      statuses = IssueStatus.sorted.to_a
      counts = Issue.visible(@user)
                    .where(project_id: @board_context.project_ids, status_id: statuses.map(&:id))
                    .group(:status_id)
                    .count
      {
        ok: true,
        contract_version: 3,
        scope_fingerprint: @board_context.scope_fingerprint,
        columns: statuses.map { |status| { id: status.id, name: status.name, is_closed: status.is_closed, count: counts[status.id].to_i } }
      }
    end
  end
end
