require 'digest'
require 'json'

module RedmineKanban
  module BulkIdempotency
    PROCESSING_TTL = 10.minutes
    COMPLETED_TTL = 24.hours

    class << self
      def with_request(user_id:, project_id:, idempotency_key:, payload: {})
        cache_key = key(user_id: user_id, project_id: project_id, idempotency_key: idempotency_key)
        digest = payload_digest(payload)

        claimed = claim_mutex.synchronize do
          existing = Rails.cache.read(cache_key)
          if existing && !payload_matches?(existing, digest)
            payload_conflict_response
          elsif completed?(existing)
            completed_result(existing)
          elsif processing?(existing)
            processing_response
          else
            Rails.cache.write(
              cache_key,
              { 'status' => 'processing', 'payload_digest' => digest },
              expires_in: PROCESSING_TTL,
              unless_exist: true
            )
          end
        end

        return claimed if claimed.is_a?(Hash)

        unless claimed
          return claim_mutex.synchronize do
            existing = Rails.cache.read(cache_key)
            return payload_conflict_response if existing && !payload_matches?(existing, digest)
            return completed_result(existing) if completed?(existing)
            return processing_response if processing?(existing)
            processing_response
          end
        end

        result = yield
        if result[:ok]
          Rails.cache.write(
            cache_key,
            { 'status' => 'completed', 'payload_digest' => digest, 'response' => result },
            expires_in: COMPLETED_TTL
          )
        else
          # Validation failures are retryable with the same client key.
          Rails.cache.delete(cache_key)
        end
        result
      rescue StandardError
        Rails.cache.delete(cache_key)
        raise
      end

      private

      def key(user_id:, project_id:, idempotency_key:)
        ['redmine_kanban', 'bulk_create', user_id, project_id, idempotency_key.to_s].join(':')
      end

      def completed?(entry)
        entry && (entry['status'] || entry[:status]) == 'completed'
      end

      def processing?(entry)
        entry && (entry['status'] || entry[:status]) == 'processing'
      end

      def completed_result(entry)
        (entry['response'] || entry[:response]).deep_symbolize_keys
      end

      def processing_response
        { ok: false, message: I18n.t('redmine_kanban.error_bulk_processing'), field_errors: {}, http_status: :conflict }
      end

      def payload_conflict_response
        { ok: false, message: I18n.t('redmine_kanban.error_idempotency_conflict'), field_errors: {}, http_status: :conflict }
      end

      def payload_matches?(entry, digest)
        (entry['payload_digest'] || entry[:payload_digest]) == digest
      end

      def payload_digest(payload)
        Digest::SHA256.hexdigest(JSON.generate(canonicalize(payload)))
      end

      def canonicalize(value)
        value = value.to_unsafe_h if value.respond_to?(:to_unsafe_h)
        case value
        when Hash
          value.each_with_object({}) do |(key, child), result|
            result[key.to_s] = canonicalize(child)
          end.sort.to_h
        when Array
          value.map { |child| canonicalize(child) }
        else
          value
        end
      end

      def claim_mutex
        @claim_mutex ||= Mutex.new
      end
    end
  end
end
