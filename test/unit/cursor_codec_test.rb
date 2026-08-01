require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))

class RedmineKanbanCursorCodecTest < ActiveSupport::TestCase
  def setup
    @codec = RedmineKanban::CursorCodec.new(secret: 'redmine-kanban-test-secret')
    @payload = {
      kind: 'root',
      scope_fingerprint: 'sha256:scope',
      filter_fingerprint: 'sha256:filter',
      parent_id: nil,
      sort: 'updated_on_desc_id_desc',
      key: { updated_on: '2026-08-01T00:00:00Z', id: 12 }
    }
  end

  def test_round_trip_preserves_cursor_payload
    cursor = @codec.encode(**@payload)

    decoded = @codec.decode(cursor, expected: {
      kind: 'root',
      scope_fingerprint: 'sha256:scope',
      filter_fingerprint: 'sha256:filter'
    })
    assert_equal RedmineKanban::CursorCodec::VERSION, decoded['version']
    assert_equal @payload.deep_stringify_keys, decoded.except('version')
  end

  def test_rejects_tampered_cursor
    cursor = @codec.encode(**@payload)

    assert_raises(RedmineKanban::CursorCodec::InvalidCursor) do
      @codec.decode("#{cursor}tampered")
    end
  end

  def test_rejects_cursor_from_another_scope_or_parent
    cursor = @codec.encode(**@payload)

    assert_raises(RedmineKanban::CursorCodec::InvalidCursor) do
      @codec.decode(cursor, expected: { kind: 'root', scope_fingerprint: 'sha256:other' })
    end
  end

  def test_rejects_wrong_cursor_kind
    cursor = @codec.encode(**@payload)

    assert_raises(RedmineKanban::CursorCodec::InvalidCursor) do
      @codec.decode(cursor, expected: { kind: 'tree', parent_id: 12 })
    end
  end
end
