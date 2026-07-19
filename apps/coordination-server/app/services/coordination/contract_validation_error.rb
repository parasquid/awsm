module Coordination
  class ContractValidationError < Committee::ValidationError
    def error_body
      {
        outcome: "REQUEST_INVALID",
        retryable: false,
        requestId: request.get_header("HTTP_AWSM_REQUEST_ID") || request.get_header("action_dispatch.request_id")
      }
    end

    def render
      protocol = request.get_header("HTTP_AWSM_PROTOCOL_VERSION") || "1"
      request_id = request.get_header("HTTP_AWSM_REQUEST_ID")
      headers = { "Content-Type" => "application/json", "Awsm-Protocol-Version" => protocol }
      headers["Awsm-Request-ID"] = request_id if request_id
      [ status, headers, [ JSON.generate(error_body) ] ]
    end
  end
end
