module RedmineKanban
  class BulkPayloadNormalizer
    class Error < StandardError
      attr_reader :field, :row_index, :row_key

      def initialize(message, field: 'subtasks', row_index: nil, row_key: nil)
        super(message)
        @field = field
        @row_index = row_index
        @row_key = row_key
      end

      def field_errors
        label = row_key.nil? ? row_index : row_key
        return { field => [message] } if label.nil?

        { "#{field}[#{label}]" => [message] }
      end
    end

    class << self
      def normalize_collection(value, field: 'subtasks')
        entries = collection_entries(value, field: field)
        entries.map do |entry|
          normalize_row(entry[:value], field: field, row_index: entry[:index], row_key: entry[:key])
        end
      end

      def normalize_row(value, field: 'subtasks', row_index: nil, row_key: nil)
        hash = if value.is_a?(Hash)
                 value
               elsif value.respond_to?(:to_unsafe_h)
                 value.to_unsafe_h
               end
        return hash.with_indifferent_access if hash.is_a?(Hash) && hash.respond_to?(:with_indifferent_access)
        return hash if hash.is_a?(Hash)

        raise Error.new(
          '各行はHash形式で指定してください',
          field: field,
          row_index: row_index,
          row_key: row_key
        )
      end

      private

      def collection_entries(value, field:)
        if value.is_a?(Array)
          return value.each_with_index.map { |row, index| { value: row, index: index, key: nil } }
        end

        hash = if value.is_a?(Hash)
                 value
               elsif value.respond_to?(:to_unsafe_h)
                 value.to_unsafe_h
               end
        unless hash.is_a?(Hash)
          raise Error.new('配列またはHash形式で指定してください', field: field)
        end

        hash.sort_by { |key, _value| collection_key(key) }.map do |key, row|
          { value: row, index: nil, key: key }
        end
      end

      def collection_key(key)
        string_key = key.to_s
        if string_key.match?(/\A\d+\z/)
          [0, string_key.to_i]
        else
          [1, string_key]
        end
      end
    end
  end
end
