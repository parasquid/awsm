require "digest"
require "securerandom"

module Coordination
  module CableTickets
    module_function

    LIFETIME = 60.seconds

    def issue(account)
      secret = SecureRandom.random_bytes(32)
      ticket = account.cable_tickets.create!(
        secret_digest: Digest::SHA256.digest(secret),
        expires_at: LIFETIME.from_now
      )
      [ "#{ticket.id}.#{ProtocolEncoding.encode_base64url(secret)}", ticket.expires_at ]
    end

    def consume(raw_ticket)
      id, encoded_secret = raw_ticket.to_s.split(".", 2)
      secret = ProtocolEncoding.decode_base64url(encoded_secret, bytes: 32)
      CableTicket.transaction do
        ticket = CableTicket.lock.find_by(id: id)
        valid = ticket && ticket.expires_at.future? &&
          ActiveSupport::SecurityUtils.secure_compare(ticket.secret_digest,
            Digest::SHA256.digest(secret))
        raise OutcomeError.new("AUTHENTICATION_FAILED", status: :unauthorized) unless valid
        account = ticket.account
        ticket.destroy!
        account
      end
    rescue ArgumentError
      raise OutcomeError.new("AUTHENTICATION_FAILED", status: :unauthorized)
    end
  end
end
