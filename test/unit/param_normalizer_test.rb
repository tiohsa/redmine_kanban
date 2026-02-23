require File.expand_path('../../../../test/test_helper', File.expand_path(__dir__))
require_relative '../../lib/redmine_kanban/param_normalizer'

class RedmineKanbanParamNormalizerTest < ActiveSupport::TestCase
  class DummyNormalizer
    include RedmineKanban::ParamNormalizer

    def nullable_id(value)
      send(:normalize_nullable_id, value)
    end

    def optional_integer(value)
      send(:normalize_optional_integer, value)
    end

    def optional_date(value)
      send(:normalize_optional_date, value)
    end

    def optional_lock_version(value)
      send(:normalize_optional_lock_version, value)
    end
  end

  def setup
    @normalizer = DummyNormalizer.new
  end

  def test_normalize_nullable_id
    assert_nil @normalizer.nullable_id(nil)
    assert_nil @normalizer.nullable_id('')
    assert_nil @normalizer.nullable_id('null')
    assert_equal 12, @normalizer.nullable_id('12')
  end

  def test_normalize_optional_integer
    assert_nil @normalizer.optional_integer(nil)
    assert_nil @normalizer.optional_integer(' ')
    assert_equal 5, @normalizer.optional_integer('5')
  end

  def test_normalize_optional_date
    assert_nil @normalizer.optional_date(nil)
    assert_nil @normalizer.optional_date(' ')
    assert_equal Date.new(2026, 2, 23), @normalizer.optional_date('2026-02-23')
    assert_nil @normalizer.optional_date('not-a-date')
  end

  def test_normalize_optional_lock_version
    assert_nil @normalizer.optional_lock_version(nil)
    assert_nil @normalizer.optional_lock_version(' ')
    assert_equal 7, @normalizer.optional_lock_version('7')
  end
end
