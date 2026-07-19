module Coordination
  class OutcomeError < StandardError
    attr_reader :outcome, :status, :retryable, :related_object_id, :details

    def initialize(outcome, status:, retryable: false, related_object_id: nil, details: {})
      @outcome = outcome
      @status = status
      @retryable = retryable
      @related_object_id = related_object_id
      @details = details
      super(outcome)
    end
  end
end
