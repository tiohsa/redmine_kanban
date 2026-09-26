module RedmineKanban
  class BoardSnapshotTelemetry
    attr_accessor :snapshot_queries

    def initialize(project:, context:)
      @project = project
      @context = context
      @snapshot_queries = false
      @metadata_queries = false
    end

    def measure
      started_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      snapshot_query_count = 0
      metadata_query_count = 0
      total_query_count = 0
      snapshot_thread_id = Thread.current.object_id
      callback = lambda do |_name, _start, _finish, _id, payload|
        next if Thread.current.object_id != snapshot_thread_id || payload[:cached] || payload[:name] == 'SCHEMA'

        total_query_count += 1
        snapshot_query_count += 1 if @snapshot_queries
        metadata_query_count += 1 if @metadata_queries
      end

      result = nil
      ActiveSupport::Notifications.subscribed(callback, 'sql.active_record') do
        result = yield
      end

      context = @context.call
      completed_meta = result[:meta] if result[:ok]
      result[:meta][:query_count] = snapshot_query_count if result[:ok] && result[:meta]
      if snapshot_query_count > context.query_limit && result[:ok]
        result = resource_error('BOARD_QUERY_LIMIT_EXCEEDED', query_count: snapshot_query_count, maximum_queries: context.query_limit)
      end

      if total_query_count > context.total_query_limit && result[:ok]
        result = resource_error('BOARD_TOTAL_QUERY_LIMIT_EXCEEDED', query_count: total_query_count, maximum_queries: context.total_query_limit)
      end

      if result[:ok]
        bytes = response_bytes_including_metadata(result)
        if bytes > context.response_byte_limit
          result = resource_error(
            'BOARD_RESPONSE_TOO_LARGE',
            entity_count: result.dig(:meta, :entity_count),
            maximum_response_bytes: context.response_byte_limit
          )
        else
          result[:meta][:response_bytes] = bytes
        end
      end

      elapsed_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at) * 1000).round(1)
      if ENV['REDMINE_KANBAN_PERF_LOG'] == '1'
        Rails.logger.info(
          '[redmine_kanban] board_data_perf ' \
          "project_id=#{@project.id} sql_count=#{snapshot_query_count} " \
          "snapshot_query_count=#{snapshot_query_count} " \
          "metadata_query_count=#{metadata_query_count} " \
          "total_query_count=#{total_query_count} " \
          "entity_count=#{completed_meta&.dig(:entity_count)} " \
          "id_probe_count=#{completed_meta&.dig(:id_probe_count)} " \
          "materialized_row_count=#{completed_meta&.dig(:materialized_row_count)} " \
          "error_code=#{result.dig(:error, :code)} " \
          "json_bytes=#{result.to_json.bytesize} elapsed_ms=#{elapsed_ms}"
        )
      end
      result
    end

    def with_metadata_queries
      previous_snapshot = @snapshot_queries
      previous_metadata = @metadata_queries
      @snapshot_queries = false
      @metadata_queries = true
      yield
    ensure
      @snapshot_queries = previous_snapshot
      @metadata_queries = previous_metadata
    end

    def without_snapshot_queries
      previous = @snapshot_queries
      @snapshot_queries = false
      yield
    ensure
      @snapshot_queries = previous
    end

    private

    def response_bytes_including_metadata(result)
      previous_bytes = nil
      bytes = nil

      10.times do
        bytes = result.to_json.bytesize
        break if bytes == previous_bytes

        result[:meta][:response_bytes] = bytes
        previous_bytes = bytes
      end

      result.to_json.bytesize
    end

    def resource_error(code, **details)
      {
        ok: false,
        contract_version: BoardData::CONTRACT_VERSION,
        scope_fingerprint: @context.call.scope_fingerprint,
        error: { code: code, **details }
      }
    end
  end
end
