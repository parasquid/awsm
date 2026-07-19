require "rails_helper"
require "base64"
require "digest"

RSpec.describe "Vault lifecycle", type: :request do
  let(:account) { Account.create! }
  let(:vault_id) { "01900000-0000-7000-8000-000000000010" }
  let(:generation_id) { "01900000-0000-7000-8000-000000000011" }
  let(:checksum) { Base64.urlsafe_encode64(Digest::SHA256.digest("generation"), padding: false) }
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

  it "attaches a provisional Vault with a Generation-zero upload and scoped ticket" do
    post "/api/vaults", params: attach_body.to_json, headers: headers

    expect(response).to have_http_status(:created)
    expect(response.parsed_body.dig("vault", "state")).to eq("Provisional")
    expect(response.parsed_body.dig("upload", "objectId")).to eq(generation_id)
    expect(response.parsed_body.dig("ticket", "method")).to eq("PUT")
    expect(VaultReplica.find_by!(vault_id:).account).to eq(account)
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
    other = Account.create!
    VaultReplica.create!(account: other, vault_id:, state: "Provisional", head_cursor: 0,
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
end
