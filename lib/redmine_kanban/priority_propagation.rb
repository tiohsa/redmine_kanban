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

    def priority_lock_versions_for(issue)
      ([issue] + issue.children.to_a).to_h { |item| [item.id, item.lock_version] }
    end

    def reconcile_priorities_after_commit!(issue, priority_id, expected_lock_versions)
      return nil unless priority_id.is_a?(Integer)

      issue.reload
      return nil unless expected_lock_versions.key?(issue.id)
      issue_error = ensure_priority_applied!(issue, priority_id, expected_lock_versions[issue.id])
      return issue_error if issue_error

      issue.children.each do |child|
        child.reload
        next unless expected_lock_versions.key?(child.id)
        child_error = ensure_priority_applied!(child, priority_id, expected_lock_versions[child.id])
        return child_error if child_error
      end

      nil
    end

    def ensure_priority_applied!(issue, priority_id, expected_lock_version = nil)
      return nil unless priority_id.is_a?(Integer)

      # Child saves may update the parent through Redmine callbacks. Reload so
      # the final reconciliation observes the database value instead of the
      # priority that was assigned to this in-memory instance before a child
      # callback ran.
      issue.reload
      return nil if issue.priority_id == priority_id

      if expected_lock_version
        updated = Issue.where(id: issue.id, lock_version: expected_lock_version)
                       .update_all(priority_id: priority_id, lock_version: expected_lock_version + 1)
        if updated == 1
          issue.reload
          return nil
        end

        return nil
      end

      issue.update_column(:priority_id, priority_id)
      issue.priority_id = priority_id
      nil
    rescue StandardError => e
      "チケット ##{issue.id} の優先度を反映できません: #{e.message}"
    end
  end
end
