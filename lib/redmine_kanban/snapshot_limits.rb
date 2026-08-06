module RedmineKanban
  class SnapshotLimits
    DEFAULT_BOARD_ENTITY_LIMIT = 1_500
    DEFAULT_SERVER_ENTITY_LIMIT = 5_000
    DEFAULT_RESPONSE_BYTES = 8 * 1024 * 1024
    DEFAULT_QUERY_LIMIT = 20
    INTEGER_MAX = 2_147_483_647

    class InvalidLimit < StandardError; end

    def self.requested(value)
      return DEFAULT_BOARD_ENTITY_LIMIT if value.nil?

      raw = value.to_s.strip
      raise InvalidLimit, 'board_entity_limit must be a positive integer' unless raw.match?(/\A[1-9][0-9]*\z/)

      parsed = Integer(raw, 10)
      raise InvalidLimit, 'board_entity_limit is out of range' if parsed > INTEGER_MAX

      parsed
    rescue ArgumentError
      raise InvalidLimit, 'board_entity_limit must be a positive integer'
    end

    def self.env_positive_integer(name, default)
      raw = ENV[name].to_s.strip
      return default if raw.empty? || !raw.match?(/\A[1-9][0-9]*\z/)

      parsed = Integer(raw, 10)
      return default if parsed > INTEGER_MAX

      parsed
    rescue ArgumentError
      default
    end

    def self.server_entity_limit
      env_positive_integer('REDMINE_KANBAN_MAX_BOARD_ENTITIES', DEFAULT_SERVER_ENTITY_LIMIT)
    end

    def self.response_bytes
      env_positive_integer('REDMINE_KANBAN_MAX_RESPONSE_BYTES', DEFAULT_RESPONSE_BYTES)
    end

    def self.query_limit
      env_positive_integer('REDMINE_KANBAN_MAX_BOARD_QUERIES', DEFAULT_QUERY_LIMIT)
    end

    def self.effective(requested)
      [requested, server_entity_limit].min
    end

    private_class_method :env_positive_integer
  end
end
