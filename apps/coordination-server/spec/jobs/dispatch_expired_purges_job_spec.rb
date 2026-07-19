require "rails_helper"

RSpec.describe DispatchExpiredPurgesJob, type: :job do
  it "snapshots every expired superseded Generation for one Vault into an automatic purge" do
    account = Account.create!
    vault = account.vault_replicas.create!(vault_id: "01900000-0000-7000-8000-000000000070",
      state: "Active", head_cursor: 1, active_generation_number: 1)
    expired = vault.vault_generations.create!(generation_id: "01900000-0000-7000-8000-000000000071",
      generation_number: 0, state: "Superseded", superseded_at: 2.days.ago,
      purge_after: 1.minute.ago)
    active = vault.vault_generations.create!(generation_id: "01900000-0000-7000-8000-000000000072",
      generation_number: 1, state: "Active", predecessor_generation: expired,
      activated_at: 1.day.ago)
    vault.update!(active_generation: active)

    described_class.perform_now

    purge = PurgeJob.find_by!(vault_replica: vault)
    expect(purge.reason).to eq("Automatic")
    expect(purge.vault_generations).to contain_exactly(expired)
    expect(expired.reload.state).to eq("Purging")
  end
end
