class PurgeJobGeneration < ApplicationRecord
  belongs_to :purge_job
  belongs_to :vault_generation
end
