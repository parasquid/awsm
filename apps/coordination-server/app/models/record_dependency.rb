class RecordDependency < ApplicationRecord
  belongs_to :event_record, class_name: "OpaqueRecord", inverse_of: :record_dependencies
  belongs_to :dependency_record, class_name: "OpaqueRecord"
end
