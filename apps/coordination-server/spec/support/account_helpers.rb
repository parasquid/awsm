module AccountHelpers
  def account_attributes(email: nil)
    sequence = SecureRandom.uuid
    {
      email: email || "reader-#{sequence}@example.test",
      authentication_secret: "test-authentication-secret-#{sequence}",
      account_key_id: SecureRandom.uuid,
      kdf_salt: SecureRandom.random_bytes(16),
      kdf_operations: Account::KDF_OPERATIONS,
      kdf_memory_bytes: Account::KDF_MEMORY_BYTES,
      key_envelope_algorithm: Account::KEY_ENVELOPE_ALGORITHM,
      key_envelope_nonce: SecureRandom.random_bytes(24),
      key_envelope_ciphertext: SecureRandom.random_bytes(48)
    }
  end

  def create_account(**attributes)
    Account.create!(**account_attributes.merge(attributes))
  end

  def vault_slot_attributes(account:, vault_id:)
    {
      account_slot_id: SecureRandom.uuid,
      account_key_id: account.account_key_id,
      account_slot_algorithm: Account::VAULT_SLOT_ALGORITHM,
      account_slot_nonce: SecureRandom.random_bytes(24),
      account_slot_ciphertext: SecureRandom.random_bytes(48)
    }
  end
end
