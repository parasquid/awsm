class GenerationReachabilityPage < ApplicationRecord
  belongs_to :vault_generation
  has_many :generation_reachability_entries, dependent: :destroy
end
