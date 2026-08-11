module RedmineKanban
  module ServiceResponse
    private

    def error_response(message, status: :unprocessable_entity, field_errors: {}, code: nil)
      response = { ok: false, message: message, field_errors: field_errors, http_status: status }
      response[:error] = { code: code } if code
      response
    end
  end
end
