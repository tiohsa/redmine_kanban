module RedmineKanban
  module ParamNormalizer
    private

    def normalize_nullable_id(value)
      return nil if value.nil? || value.to_s == '' || value.to_s == 'null'

      value.to_i
    end

    def normalize_optional_integer(value)
      v = value.to_s.strip
      return nil if v.empty?

      v.to_i
    end

    def normalize_optional_date(value)
      v = value.to_s.strip
      return nil if v.empty?

      Date.parse(v)
    rescue ArgumentError
      nil
    end

    def normalize_optional_lock_version(value)
      return nil if value.nil? || value.to_s.strip.empty?

      value.to_i
    end

    def normalize_active_priority_id(value)
      v = value.to_s.strip
      return nil if v.empty? || v == 'null'
      return :invalid unless v.match?(/\A\d+\z/)

      parsed = v.to_i
      return :invalid unless parsed.positive?
      return :invalid unless IssuePriority.active.exists?(id: parsed)

      parsed
    end
  end
end
