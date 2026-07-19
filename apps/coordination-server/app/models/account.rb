class Account < ApplicationRecord
  has_many :vault_replicas, dependent: :restrict_with_exception
end
