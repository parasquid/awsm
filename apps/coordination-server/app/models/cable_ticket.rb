class CableTicket < ApplicationRecord
  belongs_to :account

  validates :secret_digest, length: { is: 32 }
end
