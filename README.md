# Drauf

Self-hosted shopping lists and weekly meal planning for households.
Add items in seconds, share lists in real time, keep your data on your own server.

> **Status:** early development. Nothing to install yet.

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

| Client | Where |
| --- | --- |
| Web app (PWA) | Served by the server image |
| iOS app | [drauf-app/drauf-ios](https://github.com/drauf-app/drauf-ios) |

## Language

The first release ships in German. All user-facing text goes through i18n from day one, so translations are welcome later.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: see [SECURITY.md](SECURITY.md).

## License

[GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, you must offer its source code to its users.
