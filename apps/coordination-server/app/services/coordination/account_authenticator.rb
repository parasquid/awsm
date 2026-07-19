require "digest"

module Coordination
  AccountPrincipal = Data.define(:account, :confirmed_at)

  class AccountAuthenticator
    class << self
      def authenticate(request)
        credential = bearer_credential(request)
        authenticate_credential(credential)
      end

      def authenticate_credential(credential)
        raise OutcomeError.new("AUTHENTICATION_FAILED", status: :unauthorized) if credential.nil?

        unless proof_enabled?
          raise OutcomeError.new("AUTHENTICATION_UNAVAILABLE", status: :service_unavailable,
            retryable: true)
        end

        expected = ENV.fetch("AWSM_PROOF_ACCOUNT_TOKEN")
        unless secure_equal?(credential, expected)
          raise OutcomeError.new("AUTHENTICATION_FAILED", status: :unauthorized)
        end

        account = Account.find(ENV.fetch("AWSM_PROOF_ACCOUNT_ID"))
        AccountPrincipal.new(account:, confirmed_at: Time.current)
      end

      private

      def bearer_credential(request)
        scheme, value = request.authorization.to_s.split(" ", 2)
        value if scheme == "Bearer" && value.present?
      end

      def proof_enabled?
        Rails.env.test? && ENV["AWSM_SYNC_PROOF"] == "true" &&
          ENV["AWSM_PROOF_ACCOUNT_TOKEN"].present? && ENV["AWSM_PROOF_ACCOUNT_ID"].present?
      end

      def secure_equal?(left, right)
        left_digest = Digest::SHA256.digest(left)
        right_digest = Digest::SHA256.digest(right)
        ActiveSupport::SecurityUtils.secure_compare(left_digest, right_digest)
      end
    end
  end
end
