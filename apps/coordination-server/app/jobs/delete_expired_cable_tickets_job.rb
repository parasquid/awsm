class DeleteExpiredCableTicketsJob < ApplicationJob
  queue_as :default

  def perform
    CableTicket.where(expires_at: ..Time.current).delete_all
  end
end
