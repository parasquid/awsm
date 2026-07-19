require "digest"

module Coordination
  class AccountSignup
    def self.call(request:, attributes:)
      new(request:, attributes:).call
    end

    def initialize(request:, attributes:)
      @request = request
      @attributes = attributes
    end

    def call
      Account.transaction do
        if (registration = SignupRegistration.lock.find_by(idempotency_key: key))
          conflict! unless secure_equal?(registration.request_sha256, request_sha256)
          account = registration.account
          return [ account, SessionCredentials.issue(account:) ]
        end

        account = Account.create!(**@attributes)
        SignupRegistration.create!(account:, idempotency_key: key, request_sha256:)
        [ account, SessionCredentials.issue(account:) ]
      end
    rescue ActiveRecord::RecordNotUnique
      registration = SignupRegistration.find_by(idempotency_key: key)
      raise unless registration
      retry
    end

    private

    def key
      @key ||= begin
        value = @request.headers["Idempotency-Key"]
        unless value&.match?(/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/)
          raise OutcomeError.new("REQUEST_INVALID", status: :bad_request)
        end
        value
      end
    end

    def request_sha256
      @request_sha256 ||= Digest::SHA256.digest(
        [ @request.request_method, @request.path, @request.raw_post ].join("\0")
      )
    end

    def secure_equal?(left, right)
      left.bytesize == right.bytesize && ActiveSupport::SecurityUtils.secure_compare(left, right)
    end

    def conflict!
      raise OutcomeError.new("IDEMPOTENCY_CONFLICT", status: :conflict)
    end
  end
end
