# CLAUDE.md – Drauf

Self-hosted shopping lists and weekly meal planning (see README.md).
This repository holds the server, the web app (PWA), recipe providers and the item catalogue.
The iOS app lives in `drauf-app/drauf-ios` and talks to the same API.

## Planned layout (pnpm workspace)

```
apps/server        API, WebSocket sync, auth, serves the web app
apps/web           PWA (installable on desktop, Android, iPad)
packages/shared    Types and schemas shared by server, web and API clients
packages/providers Recipe providers (plugins), one folder per provider
packages/catalog   Item catalogue as data files (items, categories, synonyms, variants, icons)
docker/            Dockerfile and compose example
```

The stack is settled in the first pull requests. Starting point:

- TypeScript (strict) everywhere, Node LTS, pnpm workspaces
- Server: a small HTTP framework (Hono or Fastify), WebSocket for live updates
- Database: PostgreSQL; SQLite as an option for small installs – keep queries portable
- Auth: OpenID Connect (authorization code + PKCE, user matched by `sub`) and local accounts (Argon2id); local login can be disabled
- One Docker image serves API and web app; configuration only via environment variables

## Domain rules that shape the code

- One fixed default household in v1; the data model already allows a list to belong to several households.
- Access is granted per list (owner + members) and per meal plan – check it on **every** request, server-side, including IDs nested in payloads.
- Same item added twice → one entry; quantities with the same unit are summed, different units are shown side by side ("1 piece + 50 g"). No unit conversion in v1.
- Stores are first-class objects with their own category order; the user picks the store while shopping.
- Offline first: clients queue operations; server applies them; last write per field wins, a check-off wins over an edit.

## Recipe providers

- Each provider implements `matches(input)` (accepts plain URLs **and** shared text that contains a URL) and `fetch(url)` returning title, image URL, servings and ingredient lines.
- Mapping ingredients to catalogue items is done by the core, not by providers.
- Providers run server-side only, may fetch public addresses only (SSRF guard), with timeouts and size limits.
- Store only title, link, image URL and the imported ingredients – never copy recipe instructions or full pages.

## Privacy and security

- No telemetry, no external fonts/CDNs/analytics; strict Content-Security-Policy.
- Recipe images are proxied or cached by the server so clients never contact third parties.
- Never log secrets, tokens or full request bodies.

## Conventions

- Code, comments, commit messages and docs in English; UI strings only via i18n (German is the source language).
- Conventional Commits, every commit signed off (`git commit -s`, DCO).
- Never commit to `main`. Work on a feature branch and open a pull request; the maintainer reviews before merging.
- Pin dependency versions; add tests with every feature (unit for domain logic, integration for API).
- Keep changes small; one concern per pull request.
