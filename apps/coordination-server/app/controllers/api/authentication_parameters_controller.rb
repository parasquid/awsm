module Api
  class AuthenticationParametersController < ProtocolController
    def create
      render json: Coordination::AuthenticationParameters.for(
        params.require(:email)
      )
    rescue ActionController::ParameterMissing
      raise Coordination::OutcomeError.new("ACCOUNT_INPUT_INVALID", status: :unprocessable_content)
    end
  end
end
