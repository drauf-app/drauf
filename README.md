# Drauf

Self-hosted shopping lists and weekly meal planning for households.
Add items in seconds, share lists in real time, keep your data on your own server.

> **Status:** early development, moving fast. Installable, but expect rough edges.

## What it will do

- **Shopping lists** – several lists per household (weekly shop, drugstore, butcher, gifts), each with its own members.
- **Fast entry** – type, pick, tap a quantity, size or variety chip. Done.
- **Smart merging** – the same item added twice shows up once; quantities with the same unit add up.
- **Store-aware sorting** – define your stores and their aisle order; the list sorts itself for the store you are in.
- **Weekly meal plan** – several slots per day, free text or a recipe link, and who is cooking.
- **Recipe import** – pluggable recipe providers: put a recipe on the plan and its ingredients on a list, deselecting what you already have.
- **Works offline** – check off items without signal; changes sync when you are back online.

## Principles

- **Self-hosting first** – one Docker image, one database, no dependency on any service run by this project.
- **Privacy by default** – no telemetry, no third-party assets, only the data the features need.
- **Secure** – sign in via OpenID Connect or local accounts; every request is authorised per list.
- **Open** – AGPL-3.0, community-maintained item catalogue.

## Apps

| Client        | Where                                                         |
| ------------- | ------------------------------------------------------------- |
| Web app (PWA) | Served by the server image                                    |
| iOS app       | [drauf-app/drauf-ios](https://github.com/drauf-app/drauf-ios) |

## Run it

Every push to `main` publishes `ghcr.io/drauf-app/drauf` (tags: `latest`,
`sha-<commit>`, and the version on releases) for amd64 and arm64. While this
repository is private, pulling needs a `docker login ghcr.io` with a token
that has `read:packages`.

```bash
curl -O https://raw.githubusercontent.com/drauf-app/drauf/main/docker/compose.example.yml
mv compose.example.yml compose.yml   # then edit: set AUTH_SECRET at least
docker compose up -d
docker compose exec drauf node dist/cli/create-user.js --admin alice
```

The app listens on port 3000; put the reverse proxy of your choice in front
for TLS. Data lives in the `/data` volume (SQLite) unless `DATABASE_URL`
points at PostgreSQL — the compose example documents all variables, and
migrations run automatically on startup. Back up the volume or database dump
together with the JSON export from the web app's Läden page.

## Language

The first release ships in German. All user-facing text goes through i18n from day one, so translations are welcome later.

## Development

Requires Node 24+ and pnpm 12.

```bash
pnpm install
pnpm build        # compile all packages and bundle the web app
pnpm dev          # start the server with live reload
pnpm --filter @drauf/web dev   # start the web app dev server (proxies to :3000)
pnpm test         # build, then run all tests
pnpm lint         # Biome lint + format check
```

The web app (`apps/web`, React + Vite) is a PWA served by the server itself:
the server looks for a built web app in `WEB_DIR` (default `../web/dist`,
which matches both the repo layout and the Docker image) and serves it with a
strict Content-Security-Policy and an SPA fallback. During development the
Vite dev server serves the app instead and proxies `/api` to the local server.
Changes reach other members live over the sync WebSocket; while offline, adds
and check-offs are queued locally and replayed through the sync protocol (see
`docs/sync.md`) when connectivity returns, and a service worker keeps the app
shell loadable without a network.

The server requires `AUTH_SECRET` (at least 32 characters, e.g. from
`openssl rand -base64 32`) for signing access tokens. The first account is
created on the host or in the container with the bundled CLI:

```bash
node apps/server/dist/cli/create-user.js --admin alice   # prompts for a password
# in Docker: docker compose exec drauf node dist/cli/create-user.js --admin alice
```

Further accounts can then be created by the admin via `POST /api/users`.

Sign-in via OIDC (authorization code + PKCE, any provider) is enabled by
setting `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `PUBLIC_URL` (plus
`OIDC_CLIENT_SECRET` for confidential clients). Register the callback URL
`<PUBLIC_URL>/api/auth/oidc/callback` with your provider. Accounts are matched
by the `sub` claim and created on first login; with `OIDC_ADMIN_GROUP` set,
membership in that IdP group grants (and its absence revokes) the admin role
on each login. The server starts fine while the IdP is unreachable — local
accounts keep working.

The item catalogue lives in `packages/catalog` (CC BY-SA 4.0) as plain JSON
data files — contributions need no coding. `GET /api/catalog/suggest?q=…`
powers quick-add: the household's own shopping history ranks first, base
catalogue matches (names and synonyms) follow, each with its category and the
size/variety chips. Items added without a category get one guessed on the
server — the household's learned choice first, then a catalogue match, exact
or by the German compound head ("Zwiebelsuppe" is a Suppe, "Würzspinat" a
Spinat); correcting a category once is remembered and wins from then on.
Item icons in the web app render from a bundled subset of
[OpenMoji](https://openmoji.org) line-art SVGs (CC BY-SA 4.0, like the
catalogue), drawn in the text colour so they follow light and dark mode and
look the same on every device; `apps/web/scripts/fetch-openmoji.mjs`
refreshes the assets when catalogue icons change.

Recipe providers live in `packages/providers` (one folder per provider;
Cookidoo is the first). They run server-side only, fetch public addresses
only, and store nothing beyond title, link, image URL and the imported
ingredient lines. Individual providers can be disabled via
`IMPORT_DISABLED_PROVIDERS`. Recipe images are proxied through the server so
clients never contact third parties.

The server stores its data in an SQLite file under `./data` by default; set
`DATABASE_URL=postgres://…` to use PostgreSQL instead. Schema changes are made
in `apps/server/src/db/schema/` (one file per dialect) and turned into
migrations with `pnpm --filter @drauf/server db:generate`; migrations run
automatically when the server starts. The PostgreSQL tests are skipped unless
`TEST_DATABASE_URL` points at a disposable database (CI provides one).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: see [SECURITY.md](SECURITY.md).

## License

[GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, you must offer its source code to its users.
