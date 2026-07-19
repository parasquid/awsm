require "rails_helper"

RSpec.describe DeleteExpiredCableTicketsJob do
  it "deletes only expired unused tickets" do
    account = create_account
    expired = account.cable_tickets.create!(secret_digest: "x" * 32, expires_at: 1.second.ago)
    current = account.cable_tickets.create!(secret_digest: "y" * 32, expires_at: 1.minute.from_now)

    described_class.perform_now

    expect(CableTicket.exists?(expired.id)).to be(false)
    expect(CableTicket.exists?(current.id)).to be(true)
  end
end
