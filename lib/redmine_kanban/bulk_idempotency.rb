module RedmineKanban
  module BulkIdempotency
    PROCESSING_TTL = 10.minutes
    COMPLETED_TTL = 10.minutes

    class << self
      def with_request(user_id:, project_id:, idempotency_key:)
        cache_key = key(user_id: user_id, project_id: project_id, idempotency_key: idempotency_key)

        acquired = mutex_for(cache_key).synchronize do
          return processing_response if in_process?(cache_key)
          existing = Rails.cache.read(cache_key)
          return completed_result(existing) if completed?(existing)
          return processing_response if processing?(existing)

          claimed = Rails.cache.write(
            cache_key,
            { 'status' => 'processing' },
            expires_in: PROCESSING_TTL,
            unless_exist: true
          )

          unless claimed
            existing = Rails.cache.read(cache_key)
            return completed_result(existing) if completed?(existing)

            return processing_response
          end

          mark_in_process(cache_key)
          true
        end

        result = yield
        if result[:ok]
          Rails.cache.write(
            cache_key,
            { 'status' => 'completed', 'response' => result },
            expires_in: COMPLETED_TTL
          )
        else
          Rails.cache.delete(cache_key)
        end
        result
      rescue Exception
        Rails.cache.delete(cache_key) if acquired
        raise
      ensure
        unmark_in_process(cache_key) if acquired
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

      def mutex_for(cache_key)
        mutexes_guard.synchronize { mutexes[cache_key] ||= Mutex.new }
      end

      def mutexes
        @mutexes ||= {}
      end

      def mutexes_guard
        @mutexes_guard ||= Mutex.new
      end

      def in_process
        @in_process ||= {}
      end

      def in_process?(cache_key)
        mutexes_guard.synchronize { in_process.key?(cache_key) }
      end

      def mark_in_process(cache_key)
        mutexes_guard.synchronize { in_process[cache_key] = true }
      end

      def unmark_in_process(cache_key)
        mutexes_guard.synchronize { in_process.delete(cache_key) }
      end
    end
  end
end
