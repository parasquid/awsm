class SignupRegistration < ApplicationRecord
  belongs_to :account

  validates :idempotency_key, presence: true, uniqueness: true
  validates :request_sha256, length: { is: 32 }
end
