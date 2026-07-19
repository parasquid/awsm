module Api
  class AccountsController < ProtocolController
    def create
      envelope = Coordination::AccountPayload.decode_envelope(params.require(:accountKeyEnvelope))
      account, issued = Coordination::AccountSignup.call(
        request:,
        attributes: {
          email: params.require(:email),
          authentication_secret: params.require(:authenticationSecret),
          **envelope
        }
      )
      render json: Coordination::AccountPayload.response(account:, issued:), status: :created
    rescue ActionController::ParameterMissing
      raise Coordination::OutcomeError.new("ACCOUNT_INPUT_INVALID", status: :unprocessable_content)
    rescue ActiveRecord::RecordInvalid => error
      outcome = error.record.errors.of_kind?(:email, :taken) ? "ACCOUNT_UNAVAILABLE" : "ACCOUNT_INPUT_INVALID"
      status = outcome == "ACCOUNT_UNAVAILABLE" ? :conflict : :unprocessable_content
      raise Coordination::OutcomeError.new(outcome, status:)
    end
  end
end
