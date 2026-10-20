require 'date'

module RedmineKanban
  # Canonical, SQL-backed issue predicates used by both snapshot admission and
  # mutation membership checks. The returned scope is always an Issue relation.
  class BoardIssueFilter
    DUE_MODES = %w[all overdue thisweek 3days 7days 1day custom none].freeze
    BOOLEAN_VALUES = { true => true, false => false, 'true' => true, 'false' => false, '1' => true, '0' => false }.freeze
    FILTER_KEYS = %i[q assignee_ids include_unassigned tracker_ids priority_filter_enabled priority_ids include_no_priority due due_days date_anchor].freeze

    class InvalidFilter < StandardError; end

    attr_reader :scope

    def self.from_params(params)
      param_names = {
        filter_q: :q, filter_assignee_ids: :assignee_ids, filter_include_unassigned: :include_unassigned,
        filter_tracker_ids: :tracker_ids, filter_priority_enabled: :priority_filter_enabled,
        filter_priority_ids: :priority_ids, filter_include_no_priority: :include_no_priority,
        filter_due: :due, filter_due_days: :due_days, filter_date_anchor: :date_anchor
      }
      raw = param_names.each_with_object({}) do |(param, key), values|
        values[key] = params[param] if params.key?(param) || params.key?(param.to_s)
      end
      new(raw)
    end

    def initialize(input = {})
      values = input.to_h.symbolize_keys
      @scope = canonical_scope(values)
    end

    def active?
      scope[:q].present? || scope[:assignee_ids].any? || scope[:include_unassigned] ||
        scope[:tracker_ids].any? || scope[:priority_filter_enabled] || scope[:due] != 'all'
    end

    def apply(relation)
      result = relation
      result = apply_subject(result) if scope[:q].present?
      if scope[:assignee_ids].any? || scope[:include_unassigned]
        result = if scope[:assignee_ids].any? && scope[:include_unassigned]
          result.where(assigned_to_id: scope[:assignee_ids]).or(result.where(assigned_to_id: nil))
        elsif scope[:assignee_ids].any?
          result.where(assigned_to_id: scope[:assignee_ids])
        else
          result.where(assigned_to_id: nil)
        end
      end
      result = result.where(tracker_id: scope[:tracker_ids]) if scope[:tracker_ids].any?
      if scope[:priority_filter_enabled]
        if scope[:priority_ids].any? && scope[:include_no_priority]
          result = result.where(priority_id: scope[:priority_ids]).or(result.where(priority_id: nil))
        elsif scope[:priority_ids].any?
          result = result.where(priority_id: scope[:priority_ids])
        elsif scope[:include_no_priority]
          result = result.where(priority_id: nil)
        else
          return result.none
        end
      end
      apply_due(result)
    end

    private

    def canonical_scope(input)
      q = input.fetch(:q, '').to_s.strip.downcase
      assignee_ids = normalize_ids(input.fetch(:assignee_ids, []))
      include_unassigned = normalize_boolean(input.fetch(:include_unassigned, false), :include_unassigned)
      tracker_ids = normalize_ids(input.fetch(:tracker_ids, []))
      priority_enabled = normalize_boolean(input.fetch(:priority_filter_enabled, false), :priority_filter_enabled)
      requested_priority_ids = normalize_ids(input.fetch(:priority_ids, []))
      requested_include_no_priority = normalize_boolean(input.fetch(:include_no_priority, false), :include_no_priority)
      priority_ids = priority_enabled ? requested_priority_ids : []
      include_no_priority = priority_enabled && requested_include_no_priority
      due = input.fetch(:due, 'all').to_s
      raise InvalidFilter, 'invalid due mode' unless DUE_MODES.include?(due)

      requested_due_days = input.key?(:due_days) ? normalize_integer(input[:due_days], :due_days, min: 1) : nil
      requested_date_anchor = input.key?(:date_anchor) ? normalize_date(input[:date_anchor]) : nil
      due_days = due == 'custom' ? requested_due_days : nil
      raise InvalidFilter, 'invalid due_days' if due == 'custom' && due_days.nil?
      date_anchor = %w[overdue thisweek 1day 3days 7days custom].include?(due) ? requested_date_anchor : nil
      raise InvalidFilter, 'invalid date anchor' if %w[overdue thisweek 1day 3days 7days custom].include?(due) && date_anchor.nil?
      {
        q: q,
        assignee_ids: assignee_ids,
        include_unassigned: include_unassigned,
        tracker_ids: tracker_ids,
        priority_filter_enabled: priority_enabled,
        priority_ids: priority_ids,
        include_no_priority: include_no_priority,
        due: due,
        due_days: due_days,
        date_anchor: date_anchor
      }
    end

    def normalize_ids(values)
      Array(values).map do |value|
        text = value.to_s
        raise InvalidFilter, 'invalid ID' unless text.match?(/\A[1-9]\d*\z/)
        text.to_i
      end.uniq.sort
    end

    def normalize_boolean(value, name)
      parsed = BOOLEAN_VALUES[value]
      raise InvalidFilter, "invalid #{name}" if parsed.nil?
      parsed
    end

    def normalize_integer(value, name, min:)
      text = value.to_s
      raise InvalidFilter, "invalid #{name}" unless text.match?(/\A\d+\z/)
      number = text.to_i
      raise InvalidFilter, "invalid #{name}" unless number >= min && number <= 9_007_199_254_740_991
      number
    end

    def normalize_date(value)
      text = value.to_s
      raise InvalidFilter, 'invalid date anchor' unless text.match?(/\A\d{4}-\d{2}-\d{2}\z/)
      Date.iso8601(text).iso8601
    rescue Date::Error
      raise InvalidFilter, 'invalid date anchor'
    end

    def apply_subject(relation)
      escaped = scope[:q].gsub('!', '!!').gsub('%', '!%').gsub('_', '!_')
      relation.where("LOWER(issues.subject) LIKE ? ESCAPE '!'", "%#{escaped}%")
    end

    def apply_due(relation)
      due = scope[:due]
      return relation if due == 'all'
      return relation.where(due_date: nil) if due == 'none'

      anchor = Date.iso8601(scope[:date_anchor])
      case due
      when 'overdue' then relation.where('issues.due_date < ?', anchor)
      when 'thisweek'
        monday = anchor - (anchor.cwday - 1)
        relation.where('issues.due_date >= ? AND issues.due_date < ?', monday, monday + 7)
      else
        days = due == 'custom' ? scope[:due_days] : due.to_i
        relation.where('issues.due_date >= ? AND issues.due_date < ?', anchor, anchor + days)
      end
    end
  end
end
