require "committee"
require Rails.root.join("app/services/coordination/contract_validation_error")

contract_path = ENV.fetch(
  "AWSM_OPENAPI_PATH",
  Rails.root.join("../../docs/specifications/protocol/http-api.openapi.yaml").to_s
)

# Parse during boot so unresolved references prevent a deployment from accepting traffic.
Committee::Drivers.load_from_file(contract_path,
  parser_options: { strict_reference_validation: true })

json_control_request = lambda do |request|
  request.path.start_with?("/api/") && !request.path.start_with?("/api/transfers/") &&
    request.get_header("HTTP_AWSM_PROTOCOL_VERSION") == "1"
end

Rails.application.config.middleware.insert_before 0, Committee::Middleware::RequestValidation,
  schema_path: contract_path,
  strict: true,
  strict_reference_validation: true,
  check_header: true,
  error_class: Coordination::ContractValidationError,
  accept_request_filter: json_control_request

if Rails.env.test? || ENV["AWSM_SYNC_PROOF"] == "true"
  Rails.application.config.middleware.insert_after Committee::Middleware::RequestValidation,
    Committee::Middleware::ResponseValidation,
    schema_path: contract_path,
    strict: true,
    strict_reference_validation: true,
    raise: true,
    accept_request_filter: json_control_request
end
