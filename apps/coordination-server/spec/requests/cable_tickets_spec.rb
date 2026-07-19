require "rails_helper"

RSpec.describe "Cable tickets", type: :request do
  let(:account) { create_account }
  let(:headers) do
    {
      "Awsm-Protocol-Version" => "1",
      "Awsm-Request-ID" => "01900000-0000-7000-8000-000000000082",
      "Authorization" => "Bearer test"
    }
  end

  before do
    allow(Coordination::AccountAuthenticator).to receive(:authenticate).and_return(
      Coordination::AccountPrincipal.new(account:, confirmed_at: Time.current)
    )
  end

  it "issues a digest-only Account-bound credential that can be consumed exactly once" do
    post "/api/cable-tickets", headers: headers

    expect(response).to have_http_status(:created)
    raw_ticket = response.parsed_body.fetch("ticket")
    expect(raw_ticket).to match(/\A[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}\z/)
    expect(response.parsed_body.fetch("expiresAt")).to be_present
    expect(CableTicket.last.secret_digest).not_to include(raw_ticket)

    expect(Coordination::CableTickets.consume(raw_ticket)).to eq(account)
    expect { Coordination::CableTickets.consume(raw_ticket) }
      .to raise_error(Coordination::OutcomeError, /AUTHENTICATION_FAILED/)
  end
end
