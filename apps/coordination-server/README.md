# Coordination Server

The Coordination Server is AWSM's Rails application for authenticated synchronization and opaque
storage coordination. It must not receive or interpret plaintext Vault content.

## Development with Docker Compose

From the repository root, build and start Rails and PostgreSQL for the first time:

```bash
docker compose up --build
```

For normal development after the image has been built:

```bash
docker compose up
```

Rails is available at <http://localhost:3000>. PostgreSQL is reachable only by services on the
Compose network and is not published to the host. The Rails source tree is bind-mounted into the
container, and the application runs in the standard `development` environment, so changes to
application constants, templates, and other watched files are reloaded without rebuilding the
image or restarting the server.

The server waits for PostgreSQL and runs `bin/rails db:prepare` each time it starts. PostgreSQL data
is retained in a named Docker volume across container restarts.

Run Rails commands in the application container with:

```bash
docker compose exec coordination-server bin/rails console
docker compose exec coordination-server bundle exec rspec
```

Stop the services while retaining development data:

```bash
docker compose down
```

To discard the local development database and other named-volume state, add `--volumes` to that
command. This is destructive and is not required for routine development.

## When to rebuild

Rails source is bind-mounted into the running container. Do not rebuild for ordinary changes to
models, controllers, routes, views, Jobs, Services, JavaScript, CSS, tests, or other application
code. Rails development reloading makes those changes available directly.

Rebuild the `coordination-server` image when a change affects the image rather than the mounted
source tree:

| Change                                             | Action                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `Gemfile` or `Gemfile.lock`                        | Rebuild so Bundler installs the changed gems                                   |
| `Dockerfile.development`                           | Rebuild so its changed instructions run                                        |
| `.ruby-version` or the Dockerfile's `RUBY_VERSION` | Update both to match, then rebuild                                             |
| Native or operating-system libraries               | Add or change the package in `Dockerfile.development`, then rebuild            |
| Application source, tests, or Rails configuration  | No rebuild; restart Rails only if the specific configuration is not reloadable |
| Database migration                                 | No rebuild; run `bin/rails db:migrate` in the existing container               |
| `compose.yml` service configuration                | Run `docker compose up`; Compose recreates affected containers as needed       |

Use this normal rebuild command:

```bash
docker compose up --build
```

Docker caches unchanged build steps. If `Gemfile` and `Gemfile.lock` have not changed, the cached
`bundle install` layer is reused. To refresh the matching Ruby base image as part of a rebuild:

```bash
docker compose build --pull coordination-server
docker compose up
```

Use a cache-free rebuild only when the image cache is demonstrably stale or corrupt, because it
reinstalls all operating-system packages and gems:

```bash
docker compose build --no-cache coordination-server
docker compose up
```

## Development troubleshooting

Inspect service state and recent logs first:

```bash
docker compose ps
docker compose logs --tail=100 coordination-server postgres
```

Validate the resolved Compose configuration:

```bash
docker compose config --quiet
```

If Rails code is not reloading, confirm the service is running in `development`, then restart it
without rebuilding:

```bash
docker compose exec coordination-server bin/rails runner 'puts Rails.env'
docker compose restart coordination-server
```

After adding or updating a gem, rebuild instead of running `bundle install` only in the existing
container. Container-local changes disappear when that container is recreated.

Run migrations and tests without rebuilding:

```bash
docker compose exec coordination-server bin/rails db:migrate
docker compose exec coordination-server bundle exec rspec
```
