module RedmineKanban
  class Settings
    def initialize(raw)
      @raw = raw || {}
    end

    def lane_type
      value = @raw['lane_type'].to_s
      return value if %w[none assignee].include?(value)

      'assignee'
    end

    def issue_limit
      [@raw['issue_limit'].to_i, 1].max
    end

    def hidden_status_ids
      Array(@raw['hidden_status_ids']).map(&:to_i).uniq
    end

    def wip_limit_mode
      value = @raw['wip_limit_mode'].to_s
      return value if %w[column column_lane].include?(value)

      'column'
    end

    def wip_exceed_behavior
      value = @raw['wip_exceed_behavior'].to_s
      return value if %w[block warn].include?(value)

      'block'
    end

    def wip_limits
      limits = @raw['wip_limits'].is_a?(Hash) ? @raw['wip_limits'] : {}
      limits.transform_values { |v| v.to_i }.transform_keys(&:to_i)
    end

    def aging_warn_days
      [@raw['aging_warn_days'].to_i, 0].max
    end

    def aging_danger_days
      [@raw['aging_danger_days'].to_i, aging_warn_days].max
    end

    def aging_exclude_closed?
      @raw['aging_exclude_closed'].to_s == '1'
    end

    # Returns auto-update rules for status transitions
    # Format: { status_id => { 'assigned_to_id' => value, 'priority_id' => value, ... } }
    def status_auto_updates
      raw = @raw['status_auto_updates']
      return {} unless raw.is_a?(Hash)

      raw.transform_keys(&:to_i).transform_values do |attrs|
        next {} unless attrs.is_a?(Hash)

        # Filter out "no change" markers from UI
        filtered = attrs.reject { |_, v| v == '__no_change__' }

        # Whitelist allowed attributes
        filtered.slice('done_ratio', 'start_date', 'due_date')
      end
    end

  end
end
