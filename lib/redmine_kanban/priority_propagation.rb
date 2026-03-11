module RedmineKanban
  module PriorityPropagation
    private

    def apply_priority_updates!(issue, priority_id)
      return nil unless priority_id.is_a?(Integer)

      # Re-apply around child updates so the parent keeps the intended priority.
      ensure_priority_applied!(issue, priority_id) ||
        update_children_priority!(issue, priority_id) ||
        ensure_priority_applied!(issue, priority_id)
    end

    def update_children_priority!(issue, priority_id)
      issue.children.each do |child|
        return "子チケット ##{child.id} を更新できません" unless child.editable?

        child.init_journal(@user)
        child.safe_attributes = { 'priority_id' => priority_id }
        unless child.save
          return child.errors.full_messages.join(', ')
        end

        child_priority_error = ensure_priority_applied!(child, priority_id)
        return child_priority_error if child_priority_error
      end

      nil
    end

    def ensure_priority_applied!(issue, priority_id)
      return nil unless priority_id.is_a?(Integer)
      return nil if issue.priority_id == priority_id

      issue.update_column(:priority_id, priority_id)
      issue.priority_id = priority_id
      nil
    rescue StandardError => e
      "チケット ##{issue.id} の優先度を反映できません: #{e.message}"
    end

    def reconcile_priorities_after_commit!(issue, priority_id)
      return nil unless priority_id.is_a?(Integer)

      issue.reload
      issue_error = ensure_priority_applied!(issue, priority_id)
      return issue_error if issue_error

      issue.children.each do |child|
        child.reload
        child_error = ensure_priority_applied!(child, priority_id)
        return child_error if child_error
      end

      nil
    end
  end
end
