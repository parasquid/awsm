module Api
  class ProtocolController < ActionController::API
    before_action :validate_request_id
    before_action :validate_protocol

    rescue_from Coordination::OutcomeError, with: :render_outcome
    rescue_from ActiveRecord::RecordInvalid, with: :render_invalid

    private

    def validate_request_id
      value = request.headers["Awsm-Request-ID"]
      unless value&.match?(/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/)
        raise Coordination::OutcomeError.new("REQUEST_INVALID", status: :bad_request)
      end
      response.set_header("Awsm-Request-ID", value)
    end

    def validate_protocol
      response.set_header("Awsm-Protocol-Version", "1")
      return if request.headers["Awsm-Protocol-Version"] == "1"
      raise Coordination::OutcomeError.new("PROTOCOL_VERSION_UNSUPPORTED", status: :bad_request)
    end

    def render_outcome(error)
      payload = {
        outcome: error.outcome,
        retryable: error.retryable,
        requestId: request.headers["Awsm-Request-ID"].presence || request.request_id
      }
      payload[:relatedObjectId] = error.related_object_id if error.related_object_id
      payload.merge!(error.details)
      render json: payload, status: error.status
    end

    def render_invalid(_error)
      render_outcome(Coordination::OutcomeError.new("ACCOUNT_INPUT_INVALID",
        status: :unprocessable_content))
    end
  end
end
