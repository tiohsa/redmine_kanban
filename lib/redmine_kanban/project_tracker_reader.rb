module RedmineKanban
  class ProjectTrackerReader
    def initialize(board_project:, user:)
      @board_project = board_project
      @user = user
    end

    def read(target_project_id:)
      id = target_project_id.to_i
      target_project = id.positive? ? Project.visible(@user).find_by(id: id) : @board_project
      return nil unless target_project

      trackers = target_project.trackers.sorted.to_a
      available_project_ids_by_tracker = trackers.to_h { |tracker| [tracker.id, [target_project.id]] }
      TrackerMetadataBuilder.new(
        trackers: trackers,
        available_project_ids_by_tracker: available_project_ids_by_tracker
      ).build
    end
  end
end
