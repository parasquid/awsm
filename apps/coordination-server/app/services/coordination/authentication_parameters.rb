require "openssl"

module Coordination
  module AuthenticationParameters
    module_function

    KDF_ALGORITHM = "kdf:argon2id13:account:v1"

    def for(email)
      normalized = email.to_s.strip.downcase
      synthetic_id, synthetic_salt = synthetic_values(normalized)
      account = Account.find_by(email: normalized)
      {
        accountKeyId: account&.account_key_id || synthetic_id,
        kdfAlgorithm: KDF_ALGORITHM,
        kdfSalt: ProtocolEncoding.encode_base64url(account&.kdf_salt || synthetic_salt),
        kdfOperations: Account::KDF_OPERATIONS,
        kdfMemoryBytes: Account::KDF_MEMORY_BYTES
      }
    end

    def synthetic_values(email)
      secret = ENV.fetch("AWSM_SYNTHETIC_ACCOUNT_SECRET")
      digest = OpenSSL::HMAC.digest("SHA256", secret, "account-parameters-id\0#{email}")
      bytes = digest.first(16).bytes
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      uuid_hex = bytes.pack("C*").unpack1("H*")
      uuid = [ 8, 4, 4, 4, 12 ].map { |length| uuid_hex.slice!(0, length) }.join("-")
      salt = OpenSSL::HMAC.digest("SHA256", secret, "account-parameters-salt\0#{email}").first(16)
      [ uuid, salt ]
    end
  end
end
