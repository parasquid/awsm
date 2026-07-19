require "base64"

module Coordination
  class AccountPayload
    class << self
      def decode_envelope(value)
        {
          account_key_id: value.fetch("accountKeyId"),
          kdf_salt: decode(value.fetch("kdfSalt"), 16),
          kdf_operations: value.fetch("kdfOperations"),
          kdf_memory_bytes: value.fetch("kdfMemoryBytes"),
          key_envelope_algorithm: value.fetch("wrappingAlgorithm"),
          key_envelope_nonce: decode(value.fetch("nonce"), 24),
          key_envelope_ciphertext: decode(value.fetch("ciphertext"), 48..)
        }
      rescue KeyError, ArgumentError
        raise OutcomeError.new("ACCOUNT_INPUT_INVALID", status: :unprocessable_content)
      end

      def response(account:, issued:)
        {
          account: {
            accountId: account.id,
            email: account.email,
            accountKeyEnvelope: envelope(account)
          },
          sessionId: issued.fetch(:session).id,
          accessToken: issued.fetch(:access_token),
          accessExpiresAt: issued.fetch(:access_expires_at).iso8601(3),
          refreshToken: issued.fetch(:refresh_token),
          refreshExpiresAt: issued.fetch(:refresh_expires_at).iso8601(3)
        }
      end

      def envelope(account)
        {
          version: 1,
          accountKeyId: account.account_key_id,
          kdfAlgorithm: "kdf:argon2id13:account:v1",
          kdfSalt: encode(account.kdf_salt),
          kdfOperations: account.kdf_operations,
          kdfMemoryBytes: account.kdf_memory_bytes,
          wrappingAlgorithm: account.key_envelope_algorithm,
          nonce: encode(account.key_envelope_nonce),
          ciphertext: encode(account.key_envelope_ciphertext)
        }
      end

      def decode_slot(value, vault_id:, account:)
        identity_matches = value.fetch("version") == 1 && value.fetch("vaultId") == vault_id &&
          value.fetch("accountKeyId") == account.account_key_id &&
          value.fetch("algorithm") == Account::VAULT_SLOT_ALGORITHM
        unless identity_matches
          raise OutcomeError.new("VAULT_IDENTITY_MISMATCH", status: :conflict)
        end
        {
          account_slot_id: value.fetch("slotId"),
          account_key_id: value.fetch("accountKeyId"),
          account_slot_algorithm: value.fetch("algorithm"),
          account_slot_nonce: decode(value.fetch("nonce"), 24),
          account_slot_ciphertext: decode(value.fetch("ciphertext"), 48..)
        }
      rescue KeyError, ArgumentError
        raise OutcomeError.new("ACCOUNT_INPUT_INVALID", status: :unprocessable_content)
      end

      def slot(vault)
        {
          version: 1,
          slotId: vault.account_slot_id,
          vaultId: vault.vault_id,
          accountKeyId: vault.account_key_id,
          algorithm: vault.account_slot_algorithm,
          nonce: encode(vault.account_slot_nonce),
          ciphertext: encode(vault.account_slot_ciphertext)
        }
      end

      private

      def decode(value, size)
        bytes = Base64.urlsafe_decode64(value)
        valid = size.is_a?(Range) ? size.cover?(bytes.bytesize) : bytes.bytesize == size
        raise ArgumentError unless valid && Base64.urlsafe_encode64(bytes, padding: false) == value
        bytes
      end

      def encode(value)
        Base64.urlsafe_encode64(value, padding: false)
      end
    end
  end
end
