module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :current_account

    def connect
      raw_ticket = request.params["ticket"]
      self.current_account = Coordination::CableTickets.consume(raw_ticket)
    rescue Coordination::OutcomeError, ActiveRecord::RecordNotFound
      reject_unauthorized_connection
    ensure
      scrub_ticket_from_request!
    end

    private

    def scrub_ticket_from_request!
      request.params.delete("ticket")
      request.env["QUERY_STRING"] = ""
      request.env["REQUEST_URI"] = request.path
      request.env["ORIGINAL_FULLPATH"] = request.path
      request.env.delete("action_dispatch.request.query_parameters")
      request.env.delete("rack.request.query_hash")
    end
  end
end
