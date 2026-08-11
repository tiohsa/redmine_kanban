require 'set'

module RedmineKanban
  # Builds the additive Tracker DTO shared by the board snapshot and the
  # target-project tracker lookup used by the native issue dialog.
  class TrackerMetadataBuilder
    def initialize(trackers:, available_project_ids_by_tracker: {})
      @trackers = Array(trackers).uniq { |tracker| tracker.id }
      @available_project_ids_by_tracker = available_project_ids_by_tracker
    end

    def build
      return [] if @trackers.empty?

      tracker_ids = @trackers.map(&:id)
      default_status_ids = @trackers.filter_map { |tracker| default_status_id_for(tracker) }
      transitions = WorkflowTransition
                   .where(tracker_id: tracker_ids)
                   .where('old_status_id <> new_status_id')
                   .pluck(:tracker_id, :old_status_id, :new_status_id)

      workflow_status_ids_by_tracker = Hash.new { |hash, key| hash[key] = [] }
      transition_status_ids = transitions.each_with_object([]) do |(tracker_id, old_status_id, new_status_id), ids|
        workflow_status_ids_by_tracker[tracker_id].concat([old_status_id, new_status_id])
        ids.concat([old_status_id, new_status_id])
      end
      candidate_status_ids = (transition_status_ids + default_status_ids).select { |id| id.to_i.positive? }.uniq
      status_ids = IssueStatus.where(id: candidate_status_ids).order(:position, :id).pluck(:id)
      valid_status_ids = status_ids.to_set

      @trackers.map do |tracker|
        workflow_status_ids = workflow_status_ids_by_tracker[tracker.id]
                                  .select { |id| valid_status_ids.include?(id) }
                                  .uniq
                                  .sort_by { |id| status_ids.index(id) || status_ids.length }
        default_status_id = default_status_id_for(tracker)
        default_status_id = nil unless default_status_id && valid_status_ids.include?(default_status_id)

        {
          id: tracker.id,
          name: tracker.name,
          workflow_status_ids: workflow_status_ids,
          default_status_id: default_status_id,
          available_project_ids: Array(@available_project_ids_by_tracker[tracker.id]).map(&:to_i).select(&:positive?).uniq.sort,
        }
      end
    end

    private

    def default_status_id_for(tracker)
      value = if tracker.respond_to?(:default_status_id)
                tracker.default_status_id
              elsif tracker.respond_to?(:default_status)
                tracker.default_status&.id
              end
      value.to_i.positive? ? value.to_i : nil
    end
  end
end
