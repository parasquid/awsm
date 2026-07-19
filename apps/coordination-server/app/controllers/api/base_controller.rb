module Api
  class BaseController < ProtocolController
    before_action :authenticate_account

    attr_reader :current_account, :current_principal

    private

    def authenticate_account
      @current_principal = Coordination::AccountAuthenticator.authenticate(request)
      @current_account = current_principal.account
    end
  end
end
