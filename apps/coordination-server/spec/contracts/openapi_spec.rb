require "rails_helper"
require "yaml"

RSpec.describe "Coordination HTTP contract" do
  Given(:contract_path) { Rails.root.join("../../docs/specifications/protocol/http-api.openapi.yaml") }

  context "when loading the canonical OpenAPI document" do
    When(:document) { YAML.safe_load_file(contract_path) }

    Then { document.fetch("openapi") == "3.0.3" }
    And { document.dig("info", "version") == "1" }
    And { document.fetch("paths").key?("/api/service-policy") }
    And { document.fetch("paths").key?("/api/vaults") }
    And { document.dig("components", "schemas", "VaultChangeHint", "additionalProperties") == false }
  end
end
