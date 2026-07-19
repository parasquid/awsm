require "rails_helper"

RSpec.describe "Service policy", type: :request do
  before do
    account = create_account
    allow(Coordination::AccountAuthenticator).to receive(:authenticate).and_return(
      Coordination::AccountPrincipal.new(account:, confirmed_at: Time.current)
    )
  end

  Given(:request_id) { "01900000-0000-7000-8000-000000000001" }
  Given(:headers) do
    {
      "Awsm-Protocol-Version" => "1",
      "Awsm-Request-ID" => request_id,
      "Authorization" => "Bearer proof-account-token"
    }
  end

  context "with the canonical protocol headers" do
    When { get "/api/service-policy", headers: headers }

    Then { response.status == 200 }
    And { response.headers.fetch("Awsm-Protocol-Version") == "1" }
    And { response.headers.fetch("Awsm-Request-ID") == request_id }
    And { response.parsed_body.fetch("recoveryRetentionDays") == 90 }
    And { response.parsed_body.fetch("uploadPartSizeBytes") == 8_388_608 }
  end

  context "with an unsupported protocol" do
    When { get "/api/service-policy", headers: headers.merge("Awsm-Protocol-Version" => "2") }

    Then { response.status == 400 }
    And { response.parsed_body.fetch("outcome") == "PROTOCOL_VERSION_UNSUPPORTED" }
    And { response.parsed_body.fetch("requestId") == request_id }
  end
end
