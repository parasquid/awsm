class GenerationReachabilityEntry < ApplicationRecord
  belongs_to :vault_generation
  belongs_to :generation_reachability_page
  belongs_to :opaque_record
end
