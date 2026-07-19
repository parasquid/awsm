require "rails_helper"

RSpec.describe Account, type: :model do
  let(:attributes) do
    {
      email: "reader@example.test",
      authentication_secret: "A" * 43,
      account_key_id: "01900000-0000-7000-8000-000000000010",
      kdf_salt: "s" * 16,
      key_envelope_nonce: "n" * 24,
      key_envelope_ciphertext: "c" * 48
    }
  end

  it "stores one normalized Account credential and permits at most one Vault" do
    account = described_class.create!(**attributes)

    expect(account.email).to eq("reader@example.test")
    expect(account.authentication_secret_digest).to be_present
    expect(account.authenticate_authentication_secret("A" * 43)).to eq(account)
    expect(account.authenticate_authentication_secret("B" * 43)).to be(false)
    expect(account.vault_replicas).to be_empty
  end

  it "rejects duplicate normalized email" do
    described_class.create!(**attributes)

    duplicate = described_class.new(**attributes.merge(email: "READER@EXAMPLE.TEST"))

    expect(duplicate).not_to be_valid
    expect(duplicate.errors[:email]).to be_present
  end
end
