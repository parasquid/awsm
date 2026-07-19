require "base64"

module Coordination
  module ProtocolEncoding
    module_function

    def decode_sha256(value)
      decoded = Base64.urlsafe_decode64(value.to_s)
      return decoded if decoded.bytesize == 32 && encode_sha256(decoded) == value

      raise ArgumentError
    rescue ArgumentError
      raise OutcomeError.new("REQUEST_INVALID", status: :bad_request)
    end

    def encode_sha256(value)
      Base64.urlsafe_encode64(value, padding: false)
    end

    def timestamp(value)
      value&.utc&.iso8601(3)
    end
  end
end
