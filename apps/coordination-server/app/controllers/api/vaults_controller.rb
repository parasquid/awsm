module Api
  class VaultsController < BaseController
    def create
      idempotency = Coordination::Idempotency.new(account: current_account, request:,
        operation: "AttachVault")
      if (replay = idempotency.replay)
        return render_attachment(VaultReplica.find(replay.resource_id), status: :created)
      end

      body = request.request_parameters
      object = body.fetch("generationObject")
      validate_attachment!(body, object)
      if current_account.vault_replicas.exists?
        raise Coordination::OutcomeError.new("VAULT_ACCOUNT_LIMIT_REACHED", status: :conflict)
      end
      if VaultReplica.exists?(vault_id: body.fetch("vaultId"))
        raise Coordination::OutcomeError.new("VAULT_ID_UNAVAILABLE", status: :conflict)
      end
      slot = Coordination::AccountPayload.decode_slot(body.fetch("accountSlot"),
        vault_id: body.fetch("vaultId"), account: current_account)

      vault = nil
      VaultReplica.transaction do
        vault = current_account.vault_replicas.create!(vault_id: body.fetch("vaultId"),
          state: "Provisional", head_cursor: 0, **slot,
          provisional_expires_at: Coordination::ServicePolicy.current.upload_staging_expiry_hours.hours.from_now)
        generation = vault.vault_generations.create!(generation_id: body.fetch("generationId"),
          generation_number: 0, state: "Candidate")
        record = vault.opaque_records.create!(object_id: object.fetch("objectId"),
          object_type: "VaultGeneration", byte_length: object.fetch("byteLength"),
          sha256: Coordination::ProtocolEncoding.decode_sha256(object.fetch("sha256")),
          state: "Uploading", target_generation_id: generation.generation_id)
        part_size = [ Coordination::ServicePolicy.current.upload_part_size_bytes, record.byte_length ].min
        upload = record.create_upload!(state: "Open", part_size:,
          part_count: (record.byte_length.to_f / part_size).ceil,
          expires_at: vault.provisional_expires_at, last_activity_at: Time.current)
        generation.update!(generation_record: record)
        idempotency.persist!(resource_type: "VaultReplica", resource_id: vault.id)
      end
      render_attachment(vault, status: :created)
    rescue KeyError, ActiveRecord::RecordInvalid
      raise Coordination::OutcomeError.new("REQUEST_INVALID", status: :bad_request)
    rescue ActiveRecord::RecordNotUnique
      raise Coordination::OutcomeError.new("VAULT_ID_UNAVAILABLE", status: :conflict)
    end

    def index
      render json: { vaults: current_account.vault_replicas.map { |vault| Coordination::Serializers.vault(vault) } }
    end

    def show
      render json: Coordination::Serializers.vault(account_vault!)
    end

    def complete
      idempotency = Coordination::Idempotency.new(account: current_account, request:,
        operation: "CompleteVault")
      if (replay = idempotency.replay)
        return render json: Coordination::Serializers.vault(VaultReplica.find(replay.resource_id))
      end

      vault = account_vault!
      generation_id = request.request_parameters.fetch("generationId")
      VaultReplica.transaction do
        vault.lock!
        generation = vault.vault_generations.find_by!(generation_id:)
        record = generation.generation_record
        unless vault.state == "Provisional" && generation.generation_number.zero? &&
            record&.state == "DurableUncommitted"
          raise Coordination::OutcomeError.new("VAULT_NOT_READY", status: :conflict)
        end
        record.update!(state: "Committed", committed_at: Time.current)
        generation.generation_memberships.create!(opaque_record: record)
        generation.update!(state: "Active", activated_at: Time.current)
        vault.update!(state: "Active", active_generation: generation,
          active_generation_number: 0, head_cursor: 1, provisional_expires_at: nil)
        DeliveryChange.create!(vault_replica: vault, vault_generation: generation, cursor: 1,
          kind: "GenerationActivated", accepted_at: Time.current)
        idempotency.persist!(resource_type: "VaultReplica", resource_id: vault.id)
      end
      vault.reload
      Coordination::VaultNotifier.broadcast(vault)
      render json: Coordination::Serializers.vault(vault)
    rescue KeyError, ActiveRecord::RecordNotFound
      raise Coordination::OutcomeError.new("REQUEST_INVALID", status: :bad_request)
    end

    private

    def account_vault!
      current_account.vault_replicas.find_by!(vault_id: params[:vault_id])
    rescue ActiveRecord::RecordNotFound
      raise Coordination::OutcomeError.new("VAULT_NOT_FOUND", status: :not_found)
    end

    def validate_attachment!(body, object)
      valid = body.fetch("generationNumber") == 0 && body.fetch("generationId") == object.fetch("objectId") &&
        object.fetch("objectType") == "VaultGeneration" && object.fetch("byteLength").is_a?(Integer)
      raise KeyError unless valid
    end

    def render_attachment(vault, status:)
      upload = vault.vault_generations.find_by!(generation_number: 0).generation_record.upload
      render json: { vault: Coordination::Serializers.vault(vault),
                    upload: Coordination::Serializers.upload(upload),
                    ticket: Coordination::TransferTicketIssuer.upload(account: current_account,
                      vault:, upload:) }, status:
    end
  end
end
