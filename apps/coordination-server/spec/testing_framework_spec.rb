require "rails_helper"

RSpec.describe "testing framework" do
  Given(:left) { 20 }
  Given(:right) { 22 }

  When(:result) { left + right }

  Then { result == 42 }
end
