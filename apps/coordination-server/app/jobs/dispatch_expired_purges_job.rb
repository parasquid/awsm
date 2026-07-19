class DispatchExpiredPurgesJob < ApplicationJob
  queue_as :default

  def perform
    VaultReplica.joins(:vault_generations)
      .where(vault_generations: { state: "Superseded", purge_after: ..Time.current })
      .distinct.find_each { |vault| snapshot_expired(vault) }
  end

  private

  def snapshot_expired(vault)
    purge = nil
    VaultReplica.transaction do
      vault.lock!
      next if vault.purge_jobs.where(state: [ "Pending", "Running", "FailedRetryable" ]).exists?

      generations = vault.vault_generations.where(state: "Superseded", purge_after: ..Time.current).to_a
      next if generations.empty?

      record_ids = GenerationMembership.where(vault_generation: generations).distinct.pluck(:opaque_record_id)
      purge = vault.purge_jobs.create!(state: "Pending", stage: "Snapshot", reason: "Automatic",
        generation_count: generations.length,
        record_count: record_ids.length,
        total_bytes: OpaqueRecord.where(id: record_ids).sum(:byte_length))
      generations.each do |generation|
        purge.purge_job_generations.create!(vault_generation: generation)
        generation.update!(state: "Purging", purge_started_at: Time.current)
      end
      TransferTicket.where(vault_generation: generations, purpose: "RecoveryDownload", revoked_at: nil)
        .update_all(revoked_at: Time.current)
    end
    PurgeGenerationJob.perform_later(purge.id) if purge
  end
end
