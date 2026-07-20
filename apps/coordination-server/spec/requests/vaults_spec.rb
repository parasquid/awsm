require "rails_helper"
require "base64"
require "digest"

RSpec.describe "Vault lifecycle", type: :request do
  let(:account) { create_account }
  let(:vault_id) { "01900000-0000-7000-8000-000000000010" }
  let(:generation_id) { "01900000-0000-7000-8000-000000000011" }
  let(:checksum) { Base64.urlsafe_encode64(Digest::SHA256.digest("generation"), padding: false) }
  let(:account_slot) do
    {
      version: 1,
      slotId: "01900000-0000-7000-8000-000000000015",
      vaultId: vault_id,
      accountKeyId: account.account_key_id,
      algorithm: "wrap:xchacha20poly1305:account:v1",
      nonce: Base64.urlsafe_encode64("n" * 24, padding: false),
      ciphertext: Base64.urlsafe_encode64("c" * 48, padding: false)
    }
  end
  let(:headers) do
    {
      "Awsm-Protocol-Version" => "1",
      "Awsm-Request-ID" => "01900000-0000-7000-8000-000000000012",
      "Authorization" => "Bearer proof",
      "Idempotency-Key" => "01900000-0000-7000-8000-000000000013",
      "Content-Type" => "application/json"
    }
  end
  let(:attach_body) do
    {
      vaultId: vault_id,
      generationId: generation_id,
      generationNumber: 0,
      accountSlot: account_slot,
      generationObject: {
        objectId: generation_id,
        objectType: "VaultGeneration",
        byteLength: 10,
        sha256: checksum
      }
    }
  end

  before do
    allow(Coordination::AccountAuthenticator).to receive(:authenticate).and_return(
      Coordination::AccountPrincipal.new(account:, confirmed_at: Time.current)
    )
  end

  it "attaches a provisional Vault with its current Generation upload and scoped ticket" do
    post "/api/vaults", params: attach_body.to_json, headers: headers

    expect(response).to have_http_status(:created)
    expect(response.parsed_body.dig("vault", "state")).to eq("Provisional")
    expect(response.parsed_body.dig("upload", "objectId")).to eq(generation_id)
    expect(response.parsed_body.dig("ticket", "method")).to eq("PUT")
    expect(VaultReplica.find_by!(vault_id:).account).to eq(account)
    expect(response.parsed_body.dig("vault", "accountSlot")).to eq(account_slot.deep_stringify_keys)
  end

  it "preserves a nonzero current Generation through attachment and activation" do
    current = attach_body.deep_dup
    current[:generationNumber] = 7

    post "/api/vaults", params: current.to_json, headers: headers

    expect(response).to have_http_status(:created)
    expect(response.parsed_body.fetch("vault")).to include(
      "state" => "Provisional", "generationId" => generation_id, "generationNumber" => 7
    )
    generation = VaultReplica.find_by!(vault_id:).vault_generations.find_by!(generation_id:)
    expect(generation.generation_number).to eq(7)
    generation.generation_record.update!(state: "DurableUncommitted",
      storage_key: "objects/#{generation_id}", durable_at: Time.current)

    post "/api/vaults/#{vault_id}/complete",
      params: { generationId: generation_id }.to_json,
      headers: headers.merge("Idempotency-Key" => "01900000-0000-7000-8000-000000000014")

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to include(
      "state" => "Active", "generationId" => generation_id, "generationNumber" => 7,
      "headCursor" => 1
    )
    expect(VaultReplica.find_by!(vault_id:).active_generation_number).to eq(7)
  end

  it "rejects negative and unsafe current Generation numbers" do
    [ -1, 9_007_199_254_740_992 ].each_with_index do |number, index|
      invalid = attach_body.deep_dup
      invalid[:generationNumber] = number

      post "/api/vaults", params: invalid.to_json,
        headers: headers.merge("Idempotency-Key" => format("01900000-0000-7000-8000-%012d", 20 + index))

      expect(response).to have_http_status(:bad_request)
      expect(response.parsed_body.fetch("outcome")).to eq("REQUEST_INVALID")
      expect(VaultReplica.where(account:).count).to eq(0)
    end
  end

  it "returns the same logical attachment for an identical idempotent replay" do
    post "/api/vaults", params: attach_body.to_json, headers: headers
    first_upload_id = response.parsed_body.dig("upload", "uploadId")

    post "/api/vaults", params: attach_body.to_json, headers: headers

    expect(response).to have_http_status(:created)
    expect(response.parsed_body.dig("upload", "uploadId")).to eq(first_upload_id)
    expect(VaultReplica.where(vault_id:).count).to eq(1)
  end

  it "rejects a changed body under the same idempotency key" do
    post "/api/vaults", params: attach_body.to_json, headers: headers
    changed = attach_body.deep_dup
    changed[:generationObject][:byteLength] = 11

    post "/api/vaults", params: changed.to_json, headers: headers

    expect(response).to have_http_status(:conflict)
    expect(response.parsed_body.fetch("outcome")).to eq("IDEMPOTENCY_CONFLICT")
  end

  it "does not reveal a Vault owned by another Account" do
    other = create_account
    VaultReplica.create!(account: other, vault_id:, **vault_slot_attributes(account: other, vault_id:),
      state: "Provisional", head_cursor: 0,
      provisional_expires_at: 1.day.from_now)

    post "/api/vaults", params: attach_body.to_json, headers: headers

    expect(response).to have_http_status(:conflict)
    expect(response.parsed_body.fetch("outcome")).to eq("VAULT_ID_UNAVAILABLE")
  end

  it "activates only after the Generation Object is durable" do
    post "/api/vaults", params: attach_body.to_json, headers: headers

    post "/api/vaults/#{vault_id}/complete",
      params: { generationId: generation_id }.to_json,
      headers: headers.merge("Idempotency-Key" => "01900000-0000-7000-8000-000000000014")
    expect(response).to have_http_status(:conflict)
    expect(response.parsed_body.fetch("outcome")).to eq("VAULT_NOT_READY")

    record = OpaqueRecord.find_by!(object_id: generation_id)
    record.update!(state: "DurableUncommitted", storage_key: "objects/#{generation_id}",
      durable_at: Time.current)

    post "/api/vaults/#{vault_id}/complete",
      params: { generationId: generation_id }.to_json,
      headers: headers.merge("Idempotency-Key" => "01900000-0000-7000-8000-000000000014")

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to include(
      "state" => "Active", "generationId" => generation_id, "generationNumber" => 0,
      "headCursor" => 1
    )
    expect(record.reload.state).to eq("Committed")
    expect(DeliveryChange.find_by!(vault_replica: record.vault_replica).kind).to eq("GenerationActivated")
  end

  it "returns only the authenticated Account's Vault" do
    post "/api/vaults", params: attach_body.to_json, headers: headers

    get "/api/vaults/#{vault_id}", headers: headers.except("Idempotency-Key", "Content-Type")

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to include("vaultId" => vault_id, "state" => "Provisional")
  end

  it "lists zero or one Vault and enforces the Account limit before revealing other identity state" do
    get "/api/vaults", headers: headers.except("Idempotency-Key", "Content-Type")
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to eq("vaults" => [])

    post "/api/vaults", params: attach_body.to_json, headers: headers
    get "/api/vaults", headers: headers.except("Idempotency-Key", "Content-Type")
    expect(response.parsed_body.fetch("vaults").sole.fetch("accountSlot"))
      .to eq(account_slot.deep_stringify_keys)

    second = attach_body.deep_dup
    second[:vaultId] = "01900000-0000-7000-8000-000000000016"
    second[:generationId] = "01900000-0000-7000-8000-000000000017"
    second[:generationObject][:objectId] = second[:generationId]
    second[:accountSlot][:slotId] = "01900000-0000-7000-8000-000000000018"
    second[:accountSlot][:vaultId] = second[:vaultId]
    post "/api/vaults", params: second.to_json,
      headers: headers.merge("Idempotency-Key" => "01900000-0000-7000-8000-000000000019")

    expect(response).to have_http_status(:conflict)
    expect(response.parsed_body.fetch("outcome")).to eq("VAULT_ACCOUNT_LIMIT_REACHED")
  end

  it "rejects Account slots whose authenticated identity metadata does not match" do
    mismatched = attach_body.deep_dup
    mismatched[:accountSlot][:accountKeyId] = SecureRandom.uuid

    post "/api/vaults", params: mismatched.to_json, headers: headers

    expect(response).to have_http_status(:conflict)
    expect(response.parsed_body.fetch("outcome")).to eq("VAULT_IDENTITY_MISMATCH")
    expect(VaultReplica.where(account:).count).to eq(0)
  end
end
