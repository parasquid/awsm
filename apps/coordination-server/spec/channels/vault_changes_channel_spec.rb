require "rails_helper"

RSpec.describe VaultChangesChannel do
  def channel_for(account, vault_id)
    described_class.allocate.tap do |channel|
      channel.define_singleton_method(:current_account) { account }
      channel.define_singleton_method(:params) { { "vaultId" => vault_id } }
      allow(channel).to receive_messages(stream_for: nil, reject: nil)
    end
  end

  it "streams only the authenticated Account's Vault" do
    account = create_account
    vault = account.vault_replicas.create!(
      vault_id: SecureRandom.uuid,
      **vault_slot_attributes(account:, vault_id: SecureRandom.uuid),
      state: "Active",
      head_cursor: 0
    )
    channel = channel_for(account, vault.vault_id)

    channel.subscribed

    expect(channel).to have_received(:stream_for).with(vault)
    expect(channel).not_to have_received(:reject)
  end

  it "rejects a Vault owned by a different Account" do
    owner = create_account
    vault = owner.vault_replicas.create!(
      vault_id: SecureRandom.uuid,
      **vault_slot_attributes(account: owner, vault_id: SecureRandom.uuid),
      state: "Active",
      head_cursor: 0
    )
    channel = channel_for(create_account, vault.vault_id)

    channel.subscribed

    expect(channel).to have_received(:reject)
    expect(channel).not_to have_received(:stream_for)
  end
end
