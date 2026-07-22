require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))

class AtomicClaimFailureCache < ActiveSupport::Cache::MemoryStore
  def initialize(entry)
    super()
    @entry = entry
  end

  def write(name, value, options = nil)
    if options && options[:unless_exist]
      super(name, @entry)
      return false
    end

    super
  end
end

class BulkIdempotencyTest < ActiveSupport::TestCase
  def setup
    @previous_cache_store = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    Rails.cache.clear
    bulk_idempotency.instance_variable_set(:@claim_mutex, nil)
  end

  def teardown
    Rails.cache = @previous_cache_store
    super
  end

  def test_does_not_keep_a_mutex_per_idempotency_key
    100.times do |index|
      bulk_idempotency.with_request(user_id: 1, project_id: 2, idempotency_key: "key-#{index}") do
        { ok: true, value: index }
      end
    end

    assert_nil bulk_idempotency.instance_variable_get(:@mutexes)
    assert_nil bulk_idempotency.private_methods(false).find { |method| method == :mutex_for }
    assert_instance_of Mutex, bulk_idempotency.instance_variable_get(:@claim_mutex)
  end

  def test_same_key_is_processed_only_once_when_called_concurrently
    started = Queue.new
    release = Queue.new
    results = []

    first = Thread.new do
      results << bulk_idempotency.with_request(user_id: 1, project_id: 2, idempotency_key: 'same') do
        started << true
        release.pop
        { ok: true, value: 1 }
      end
    end
    started.pop
    second = Thread.new do
      results << bulk_idempotency.with_request(user_id: 1, project_id: 2, idempotency_key: 'same') do
        { ok: true, value: 2 }
      end
    end

    second.join
    release << true
    first.join

    assert_equal 1, results.count { |result| result[:ok] }
    assert_equal 1, results.count { |result| result[:http_status] == :conflict }
  end

  def test_atomic_claim_failure_with_processing_entry_does_not_run_block
    Rails.cache = AtomicClaimFailureCache.new({ 'status' => 'processing' })
    called = false

    result = bulk_idempotency.with_request(user_id: 1, project_id: 2, idempotency_key: 'atomic-processing') do
      called = true
      { ok: true }
    end

    assert_equal :conflict, result[:http_status]
    refute called
  end

  def test_atomic_claim_failure_with_completed_entry_returns_previous_result
    previous = { ok: true, issue: { id: 42 } }
    Rails.cache = AtomicClaimFailureCache.new({ 'status' => 'completed', 'response' => previous })
    called = false

    result = bulk_idempotency.with_request(user_id: 1, project_id: 2, idempotency_key: 'atomic-completed') do
      called = true
      { ok: true, issue: { id: 99 } }
    end

    assert_equal previous, result
    refute called
  end

  def test_atomic_claim_failure_with_missing_entry_does_not_run_block
    Rails.cache = AtomicClaimFailureCache.new(nil)
    called = false

    result = bulk_idempotency.with_request(user_id: 1, project_id: 2, idempotency_key: 'atomic-missing') do
      called = true
      { ok: true }
    end

    assert_equal :conflict, result[:http_status]
    refute called
  end

  def test_validation_failure_releases_claim_for_retry
    first = bulk_idempotency.with_request(user_id: 1, project_id: 2, idempotency_key: 'validation-retry') do
      { ok: false, message: 'invalid' }
    end
    second = bulk_idempotency.with_request(user_id: 1, project_id: 2, idempotency_key: 'validation-retry') do
      { ok: true, value: 2 }
    end

    assert_equal false, first[:ok]
    assert_equal({ ok: true, value: 2 }, second)
  end

  def test_different_keys_can_run_without_waiting_for_each_other
    started = Queue.new
    release = Queue.new
    second_finished = Queue.new

    first = Thread.new do
      bulk_idempotency.with_request(user_id: 1, project_id: 2, idempotency_key: 'first') do
        started << true
        release.pop
        { ok: true }
      end
    end
    started.pop
    second = Thread.new do
      bulk_idempotency.with_request(user_id: 1, project_id: 2, idempotency_key: 'second') do
        second_finished << true
        { ok: true }
      end
    end

    assert_equal true, second_finished.pop
    release << true
    [first, second].each(&:join)
  end

  def test_exception_releases_claim_and_allows_retry
    assert_raises(RuntimeError) do
      bulk_idempotency.with_request(user_id: 1, project_id: 2, idempotency_key: 'retry') { raise 'boom' }
    end

    assert_nil Rails.cache.read(bulk_cache_key('retry'))
    result = bulk_idempotency.with_request(user_id: 1, project_id: 2, idempotency_key: 'retry') { { ok: true } }
    assert_equal true, result[:ok]
  end

  def test_completed_key_returns_previous_result_without_recreating
    result = { ok: true, issue: { id: 42 } }
    Rails.cache.write(bulk_cache_key('completed'), { 'status' => 'completed', 'response' => result })
    called = false

    actual = bulk_idempotency.with_request(user_id: 1, project_id: 2, idempotency_key: 'completed') do
      called = true
      { ok: true, issue: { id: 99 } }
    end

    assert_equal result, actual
    refute called
  end

  private

  def bulk_idempotency
    RedmineKanban::BulkIdempotency
  end

  def bulk_cache_key(key)
    ['redmine_kanban', 'bulk_create', 1, 2, key].join(':')
  end
end
