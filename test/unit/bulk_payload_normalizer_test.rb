require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/bulk_payload_normalizer'

class RedmineKanbanBulkPayloadNormalizerTest < ActiveSupport::TestCase
  def test_normalizes_array_and_numeric_hash_collections_to_the_same_ordered_rows
    rows = [
      { subject: 'First' },
      { subject: 'Second' }
    ]

    assert_equal rows.map { |row| row[:subject] }, RedmineKanban::BulkPayloadNormalizer.normalize_collection(rows).map { |row| row[:subject] }
    assert_equal rows.map { |row| row[:subject] }, RedmineKanban::BulkPayloadNormalizer.normalize_collection({ '1' => rows[1], '0' => rows[0] }).map { |row| row[:subject] }
  end

  def test_rejects_scalar_and_nil_rows_with_a_locatable_field_error
    [nil, 'scalar', ['nested']].each do |row|
      error = assert_raises(RedmineKanban::BulkPayloadNormalizer::Error) do
        RedmineKanban::BulkPayloadNormalizer.normalize_collection([row])
      end

      assert_equal "subtasks[0]", error.field_errors.keys.first
    end
  end

  def test_rejects_a_scalar_collection_before_iteration
    error = assert_raises(RedmineKanban::BulkPayloadNormalizer::Error) do
      RedmineKanban::BulkPayloadNormalizer.normalize_collection('not-a-collection')
    end

    assert_equal({ 'subtasks' => [I18n.t('redmine_kanban.error_collection_expected')] }, error.field_errors)
  end
end
