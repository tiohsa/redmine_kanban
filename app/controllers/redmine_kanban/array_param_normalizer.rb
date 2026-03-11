module RedmineKanban
  module ArrayParamNormalizer
    private

    def normalize_integer_array_param(values)
      Array(values).filter_map do |value|
        id = value.to_i
        id if id.positive?
      end
    end
  end
end
