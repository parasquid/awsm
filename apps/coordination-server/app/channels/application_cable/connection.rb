module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :current_account

    def connect
      self.current_account = Coordination::AccountAuthenticator
        .authenticate_credential(request.params["credential"]).account
    rescue Coordination::OutcomeError, ActiveRecord::RecordNotFound
      reject_unauthorized_connection
    end
  end
end
