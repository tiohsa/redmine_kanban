module RedmineKanban
  class IdempotencyRecord < ActiveRecord::Base
    self.table_name = 'redmine_kanban_idempotency_records'
  end
end
