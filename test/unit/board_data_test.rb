require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/board_data'

class RedmineKanbanBoardDataTest < ActiveSupport::TestCase
  def setup
    @previous_cache_store = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
  end

  def teardown
    Rails.cache = @previous_cache_store
    super
  end

  def test_labels_cache_uses_the_existing_scope_and_sixty_second_expiry
    board_data = board_data_for_cache

    I18n.with_locale(:en) do
      travel_to(Time.utc(2026, 9, 13)) do
        first = board_data.send(:cached_labels)
        assert_equal first, Rails.cache.read('redmine_kanban:labels:1:2:en:1-3')

        I18n.expects(:t).never
        travel 59.seconds
        assert_equal first, board_data.send(:cached_labels)
        travel 2.seconds
        assert_nil Rails.cache.read('redmine_kanban:labels:1:2:en:1-3')
      end
    end
  end

  def test_labels_cache_is_separated_by_locale_project_user_and_project_scope
    I18n.with_locale(:en) do
      board_data_for_cache.send(:cached_labels)
      board_data_for_cache(project_id: 4).send(:cached_labels)
      board_data_for_cache(user_id: 5).send(:cached_labels)
      board_data_for_cache(project_ids: [1, 6]).send(:cached_labels)
    end
    I18n.with_locale(:ja) { board_data_for_cache.send(:cached_labels) }

    %w[
      redmine_kanban:labels:1:2:en:1-3
      redmine_kanban:labels:4:2:en:1-3
      redmine_kanban:labels:1:5:en:1-3
      redmine_kanban:labels:1:2:en:1-6
      redmine_kanban:labels:1:2:ja:1-3
    ].each { |key| assert Rails.cache.exist?(key), key }

    refute_equal Rails.cache.read('redmine_kanban:labels:1:2:en:1-3')[:all],
                 Rails.cache.read('redmine_kanban:labels:1:2:ja:1-3')[:all]
    I18n.expects(:t).never
    I18n.with_locale(:en) { board_data_for_cache(project_ids: [1, 3]).send(:cached_labels) }
  end

  def test_translation_key_constant_remains_compatible
    assert_same RedmineKanban::BoardLabels::TRANSLATION_KEYS, RedmineKanban::BoardData::LABEL_TRANSLATION_KEYS
  end

  def test_total_query_limit_includes_metadata_queries
    board_data = RedmineKanban::BoardData.new(project: stub(id: 1), user: stub(id: 2))
    board_data.instance_variable_set(:@board_context, stub(query_limit: 1, total_query_limit: 1, scope_fingerprint: 'scope', response_byte_limit: 1000))
    board_data.define_singleton_method(:build_payload) do
      @count_snapshot_queries = true
      ActiveRecord::Base.connection.select_value('SELECT 1')
      @count_snapshot_queries = false
      ActiveRecord::Base.connection.select_value('SELECT 1')
      { ok: true, meta: {} }
    end

    result = board_data.to_h

    assert_equal false, result[:ok]
    assert_equal 'BOARD_TOTAL_QUERY_LIMIT_EXCEEDED', result.dig(:error, :code)
    assert_equal 2, result.dig(:error, :query_count)
  end

  private

  def board_data_for_cache(project_id: 1, user_id: 2, project_ids: [3, 1])
    board_data = RedmineKanban::BoardData.new(project: stub(id: project_id), user: stub(id: user_id))
    board_data.instance_variable_set(:@project_ids, project_ids)
    board_data
  end
end
