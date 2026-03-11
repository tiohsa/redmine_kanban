module RedmineKanban
  module ServiceResponse
    private

    def error_response(message, status: :unprocessable_entity, field_errors: {})
      { ok: false, message: message, field_errors: field_errors, http_status: status }
    end
  end
end
