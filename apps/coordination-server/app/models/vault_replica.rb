class VaultReplica < ApplicationRecord
  STATES = %w[Provisional Active].freeze

  belongs_to :account
  belongs_to :active_generation, class_name: "VaultGeneration", optional: true
  has_many :opaque_records, dependent: :restrict_with_exception
  has_many :vault_generations, dependent: :restrict_with_exception
  has_many :delivery_changes, dependent: :restrict_with_exception
  has_many :purge_jobs, dependent: :restrict_with_exception

  validates :vault_id, presence: true, uniqueness: true
  validates :account_id, uniqueness: true
  validates :account_slot_id, presence: true, uniqueness: true
  validates :account_key_id, presence: true
  validates :account_slot_algorithm, inclusion: { in: [ Account::VAULT_SLOT_ALGORITHM ] }
  validates :account_slot_nonce, length: { is: 24 }
  validates :account_slot_ciphertext, length: { minimum: 48 }
  validate :account_key_belongs_to_account
  validates :state, inclusion: { in: STATES }
  validates :head_cursor, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  private

  def account_key_belongs_to_account
    errors.add(:account_key_id, :invalid) if account && account_key_id != account.account_key_id
  end
end
