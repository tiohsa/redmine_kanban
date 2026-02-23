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
  end
end
