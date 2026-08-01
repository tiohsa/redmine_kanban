require 'active_support/message_verifier'
require 'json'

module RedmineKanban
  class CursorCodec
    VERSION = 1

    class InvalidCursor < StandardError; end

    def initialize(secret: nil)
      secret ||= Rails.application.secret_key_base if defined?(Rails) && Rails.application
      raise ArgumentError, 'cursor signing secret is required' if secret.blank?

      @verifier = ActiveSupport::MessageVerifier.new(secret, serializer: JSON)
    end

    def encode(kind:, scope_fingerprint:, filter_fingerprint:, parent_id:, sort:, key:)
      @verifier.generate({
        'version' => VERSION,
        'kind' => kind.to_s,
        'scope_fingerprint' => scope_fingerprint.to_s,
        'filter_fingerprint' => filter_fingerprint.to_s,
        'parent_id' => parent_id,
        'sort' => sort.to_s,
        'key' => key
      })
    end

    def decode(cursor, expected: {})
      payload = @verifier.verify(cursor)
      unless payload.is_a?(Hash) && payload['version'].to_i == VERSION
        raise InvalidCursor, 'unsupported cursor version'
      end

      expected.stringify_keys.each do |key, value|
        next if value.nil?
        raise InvalidCursor, "cursor #{key} does not match" unless payload[key].to_s == value.to_s
      end
      payload
    rescue ActiveSupport::MessageVerifier::InvalidSignature, JSON::ParserError, TypeError => e
      raise InvalidCursor, e.message
    end
  end
end
