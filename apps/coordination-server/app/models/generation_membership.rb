class GenerationMembership < ApplicationRecord
  belongs_to :vault_generation
  belongs_to :opaque_record
end
