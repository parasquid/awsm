class PurgeGenerationJob < ApplicationJob
  queue_as :default

  def perform(purge_id)
    purge = PurgeJob.find(purge_id)
    purge.with_lock do
      return if purge.state == "Succeeded"
      purge.update!(state: "Running", stage: "Detach", started_at: purge.started_at || Time.current,
        error_outcome: nil)
    end
    generations = purge.vault_generations.to_a
    record_ids = GenerationMembership.where(vault_generation: generations).distinct.pluck(:opaque_record_id)
    purge.update!(stage: "Analyze")

    records = OpaqueRecord.where(id: record_ids).to_a
    deletable = records.reject { |record| referenced_elsewhere?(record, generations) }
    purge.update!(stage: "DeleteBytes")
    processed = purge.processed_bytes
    deletable.each do |record|
      delete_and_verify!(record)
      processed += record.byte_length
      purge.update!(processed_bytes: processed)
    end

    purge.update!(stage: "Tombstone")
    now = Time.current
    OpaqueRecord.transaction do
      deletable.each do |record|
        TransferTicket.where(upload: record.upload).delete_all if record.upload
        record.update!(state: "Purged", storage_key: nil, purged_at: now)
        record.upload&.destroy!
      end
      GenerationMembership.where(vault_generation: generations).delete_all
      generations.each do |generation|
        generation.generation_reachability_pages.destroy_all
        generation.update!(state: "Purged", purged_at: now)
      end
      purge.update!(state: "Succeeded", stage: "Complete", completed_at: now,
        processed_bytes: deletable.sum(&:byte_length))
    end
  rescue StandardError
    if (failed = PurgeJob.find_by(id: purge_id))
      failed.update_columns(state: "FailedRetryable", error_outcome: "STORAGE_UNAVAILABLE",
        retry_count: failed.retry_count + 1, updated_at: Time.current)
    end
    raise
  end

  private

  def referenced_elsewhere?(record, purged_generations)
    record.generation_memberships.where.not(vault_generation: purged_generations).exists? ||
      GenerationReachabilityEntry.where(opaque_record: record)
        .where.not(vault_generation: purged_generations).exists? ||
      VaultGeneration.where(generation_record: record).where.not(id: purged_generations.map(&:id))
        .where.not(state: "Purged").exists?
  end

  def delete_and_verify!(record)
    return unless record.storage_key
    path = Coordination::DiskStore.path(record.storage_key)
    File.delete(path) if File.exist?(path)
    raise "opaque byte deletion could not be verified" if File.exist?(path)
  end
end
