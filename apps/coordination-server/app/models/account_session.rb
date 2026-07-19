class AccountSession < ApplicationRecord
  belongs_to :account
  has_many :session_credentials, dependent: :destroy

  validates :confirmed_at, presence: true

  def revoke!(at: Time.current)
    transaction do
      update!(revoked_at: at)
      session_credentials.where(revoked_at: nil).update_all(revoked_at: at, updated_at: at)
    end
  end

  def active?
    revoked_at.nil?
  end
end
