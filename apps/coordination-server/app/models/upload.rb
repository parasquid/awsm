class Upload < ApplicationRecord
  STATES = %w[Open Assembling Completed Expired].freeze

  belongs_to :opaque_record
  has_many :upload_parts, dependent: :destroy

  validates :state, inclusion: { in: STATES }
end
