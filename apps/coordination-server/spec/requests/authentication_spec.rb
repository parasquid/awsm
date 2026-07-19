require "rails_helper"

RSpec.describe "Account authentication", type: :request do
  Given(:request_id) { "01900000-0000-7000-8000-000000000002" }
  Given(:headers) do
    {
      "Awsm-Protocol-Version" => "1",
      "Awsm-Request-ID" => request_id
    }
  end

  context "without a bearer credential" do
    When { get "/api/service-policy", headers: headers }

    Then { response.status == 401 }
    And { response.parsed_body.fetch("outcome") == "AUTHENTICATION_FAILED" }
  end

  context "without a configured authenticator" do
    When { get "/api/service-policy", headers: headers.merge("Authorization" => "Bearer value") }

    Then { response.status == 503 }
    And { response.parsed_body.fetch("outcome") == "AUTHENTICATION_UNAVAILABLE" }
  end
end
