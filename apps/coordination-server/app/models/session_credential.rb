class SessionCredential < ApplicationRecord
  KINDS = %w[Access Refresh].freeze

  belongs_to :account_session

  validates :kind, inclusion: { in: KINDS }
  validates :secret_digest, length: { is: 32 }
  validates :expires_at, presence: true

  def usable?(at: Time.current)
    revoked_at.nil? && consumed_at.nil? && expires_at > at && account_session.active?
  end
end
