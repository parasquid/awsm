class ReadinessController < ActionController::API
  def show
    ActiveRecord::Base.connection.select_value("SELECT 1")
    root = Coordination::DiskStore.root
    FileUtils.mkdir_p(root)
    probe = root.join(".readiness-#{Process.pid}")
    File.open(probe, File::WRONLY | File::CREAT | File::EXCL, 0o600) { |file| file.write("ready") }
    File.delete(probe)
    render json: { status: "ready" }
  rescue StandardError => error
    Rails.error.report(error, handled: true, context: { component: "readiness" })
    render json: { status: "unavailable" }, status: :service_unavailable
  ensure
    File.delete(probe) if defined?(probe) && probe && File.exist?(probe)
  end
end
