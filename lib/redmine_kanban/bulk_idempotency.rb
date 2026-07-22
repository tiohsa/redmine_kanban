module RedmineKanban
  module BulkIdempotency
    PROCESSING_TTL = 10.minutes
    COMPLETED_TTL = 24.hours

    class << self
      def with_request(user_id:, project_id:, idempotency_key:)
        cache_key = key(user_id: user_id, project_id: project_id, idempotency_key: idempotency_key)

        claim_mutex.synchronize do
          existing = Rails.cache.read(cache_key)
          return completed_result(existing) if completed?(existing)
          return processing_response if processing?(existing)

          claimed = Rails.cache.write(
            cache_key,
            { 'status' => 'processing' },
            expires_in: PROCESSING_TTL,
            unless_exist: true
          )
          next true if claimed

          existing = Rails.cache.read(cache_key)
          completed?(existing) ? completed_result(existing) : processing_response
        end

        result = yield
        if result[:ok]
          Rails.cache.write(
            cache_key,
            { 'status' => 'completed', 'response' => result },
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
        { ok: false, message: '同じ一括作成リクエストが処理中です', field_errors: {}, http_status: :conflict }
      end

      def claim_mutex
        @claim_mutex ||= Mutex.new
      end
    end
  end
end
