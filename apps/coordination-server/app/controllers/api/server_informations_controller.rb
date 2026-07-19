module Api
  class ServerInformationsController < ProtocolController
    def show
      render json: {
        service: "AWSM Coordination Server",
        protocolVersion: "1",
        capabilities: {
          accountPassword: true,
          accountVaultLimit: 1,
          completeReplicaSynchronization: true
        }
      }
    end
  end
end
