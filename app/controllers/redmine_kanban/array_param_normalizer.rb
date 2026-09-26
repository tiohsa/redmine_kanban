module RedmineKanban
  module ArrayParamNormalizer
    class InvalidIssueIds < StandardError
      attr_reader :code

      def initialize(code)
        @code = code
        super(code)
      end
    end

    private

    def normalize_issue_ids_param(values)
      items = values.nil? ? [] : Array(values)
      limit = SnapshotLimits.entity_reconciliation_limit
      raise InvalidIssueIds, 'ENTITY_IDS_LIMIT_EXCEEDED' if items.size > limit

      items.map do |value|
        raw = value.to_s
        raise InvalidIssueIds, 'INVALID_ENTITY_IDS' unless raw.match?(/\A[1-9][0-9]*\z/)

        id = Integer(raw, 10)
        raise InvalidIssueIds, 'INVALID_ENTITY_IDS' if id > SnapshotLimits::INTEGER_MAX

        id
      end.uniq
    end

    def normalize_integer_array_param(values)
      Array(values).filter_map do |value|
        id = value.to_i
        id if id.positive?
      end
    end
  end
end
