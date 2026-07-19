class DeliveryChange < ApplicationRecord
  KINDS = %w[EventCommitted GenerationActivated].freeze

  belongs_to :vault_replica
  belongs_to :vault_generation
  belongs_to :event_commit, optional: true

  validates :kind, inclusion: { in: KINDS }
end
