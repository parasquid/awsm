class VaultGeneration < ApplicationRecord
  STATES = %w[Candidate Active Superseded Purging Purged].freeze

  belongs_to :vault_replica
  belongs_to :predecessor_generation, class_name: "VaultGeneration", optional: true
  belongs_to :generation_record, class_name: "OpaqueRecord", optional: true
  has_many :generation_memberships, dependent: :destroy
  has_many :opaque_records, through: :generation_memberships
  has_many :generation_reachability_pages, dependent: :destroy
  has_many :generation_reachability_entries, dependent: :destroy

  validates :generation_id, presence: true, uniqueness: true
  validates :generation_number, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :state, inclusion: { in: STATES }
end
