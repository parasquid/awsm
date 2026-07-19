Rails.application.routes.draw do
  mount ActionCable.server => "/cable"

  namespace :api do
    resource :server_information, only: :show, path: "server-information"
    resources :accounts, only: :create
    resources :authentication_parameters, only: :create, path: "authentication-parameters"
    resources :sessions, only: :create
    post "session/refresh", to: "sessions#refresh"
    delete "session", to: "session#destroy"
    resources :cable_tickets, only: :create, path: "cable-tickets"
    resource :service_policy, only: :show, path: "service-policy"
    resources :vaults, only: [ :index, :create, :show ], param: :vault_id do
      post :complete, on: :member
    end
    post "vaults/:vault_id/uploads", to: "uploads#create"
    get "vaults/:vault_id/uploads/:upload_id", to: "uploads#show"
    post "vaults/:vault_id/uploads/:upload_id/ticket", to: "uploads#ticket"
    post "vaults/:vault_id/uploads/:upload_id/complete", to: "uploads#complete"
    post "vaults/:vault_id/commits", to: "commits#create"
    get "vaults/:vault_id/records", to: "records#index"
    get "vaults/:vault_id/changes", to: "changes#index"
    post "vaults/:vault_id/records/:object_id/downloads", to: "records#download"
    post "vaults/:vault_id/generation-candidates", to: "generation_candidates#create"
    delete "vaults/:vault_id/generation-candidates/:generation_id", to: "generation_candidates#destroy"
    put "vaults/:vault_id/generation-candidates/:generation_id/retained-pages/:page_number",
      to: "generation_candidates#put_page"
    post "vaults/:vault_id/generation-candidates/:generation_id/seal", to: "generation_candidates#seal"
    post "vaults/:vault_id/generation-candidates/:generation_id/activate", to: "generation_candidates#activate"
    get "vaults/:vault_id/recoveries", to: "recoveries#index"
    get "vaults/:vault_id/recoveries/:generation_id/records", to: "recoveries#records"
    post "vaults/:vault_id/recoveries/:generation_id/records/:object_id/downloads",
      to: "recoveries#download"
    post "vaults/:vault_id/purges", to: "purges#create"
    get "vaults/:vault_id/purges/:purge_id", to: "purges#show"
    put "transfers/:ticket/parts/:part_number", to: "transfers#put_part"
    get "transfers/:ticket", to: "transfers#show"
  end

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check
  get "ready" => "readiness#show", as: :readiness

  # Render dynamic PWA files from app/views/pwa/* (remember to link manifest in application.html.erb)
  # get "manifest" => "rails/pwa#manifest", as: :pwa_manifest
  # get "service-worker" => "rails/pwa#service_worker", as: :pwa_service_worker

  # Defines the root path route ("/")
  # root "posts#index"
end
