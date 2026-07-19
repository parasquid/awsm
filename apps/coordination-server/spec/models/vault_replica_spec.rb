require "rails_helper"

RSpec.describe VaultReplica, type: :model do
  Given(:account) { Account.create! }
  Given(:vault_id) { "01900000-0000-7000-8000-000000000010" }

  When(:vault) do
    described_class.create!(
      account: account,
      vault_id: vault_id,
      state: "Provisional",
      head_cursor: 0,
      provisional_expires_at: 24.hours.from_now
    )
  end

  Then { vault.account == account }
  And { vault.state == "Provisional" }
  And { described_class.where(account: Account.create!).find_by(vault_id: vault_id).nil? }
end
