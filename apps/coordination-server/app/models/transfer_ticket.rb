class TransferTicket < ApplicationRecord
  PURPOSES = %w[UploadPart ActiveDownload RecoveryDownload].freeze

  belongs_to :account
  belongs_to :vault_replica
  belongs_to :upload, optional: true
  belongs_to :opaque_record, optional: true
  belongs_to :vault_generation, optional: true

  validates :purpose, inclusion: { in: PURPOSES }
end
