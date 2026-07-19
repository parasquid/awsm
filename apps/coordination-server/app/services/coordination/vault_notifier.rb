module Coordination
  class VaultNotifier
    def self.broadcast(vault)
      VaultChangesChannel.broadcast_to(vault,
        { vaultId: vault.vault_id, latestCursor: vault.head_cursor })
    rescue StandardError => error
      Rails.error.report(error, handled: true, context: { component: "vault_change_hint" })
    end
  end
end
