class VaultChangesChannel < ApplicationCable::Channel
  def subscribed
    vault = current_account.vault_replicas.find_by(vault_id: params["vaultId"])
    return reject unless vault

    stream_for vault
  end
end
