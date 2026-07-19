class PurgeJob < ApplicationRecord
  belongs_to :vault_replica
  has_many :purge_job_generations, dependent: :destroy
  has_many :vault_generations, through: :purge_job_generations
end
