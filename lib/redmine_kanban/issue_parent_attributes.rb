module RedmineKanban
  module IssueParentAttributes
    private

    def apply_parent_defaults!(attributes, params, parent_issue)
      return unless parent_issue

      inherit_parent_attribute!(attributes, params, 'assigned_to_id', parent_issue.assigned_to_id)
      inherit_parent_attribute!(attributes, params, 'priority_id', parent_issue.priority_id)
      inherit_parent_attribute!(attributes, params, 'start_date', parent_issue.start_date)
      inherit_parent_attribute!(attributes, params, 'due_date', parent_issue.due_date)
    end

    def inherit_parent_attribute!(attributes, params, key, parent_value)
      return if param_key_provided?(params, key)
      return if parent_value.nil?

      attributes[key] = parent_value
    end
  end
end
