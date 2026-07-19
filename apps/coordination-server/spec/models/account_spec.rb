require "rails_helper"

RSpec.describe Account, type: :model do
  Given(:account) { described_class.create! }

  Then { account.id.present? }
  And { account.vault_replicas.empty? }
end
