class EventCommit < ApplicationRecord
  belongs_to :vault_replica
  belongs_to :vault_generation
  belongs_to :event_record, class_name: "OpaqueRecord"
end
