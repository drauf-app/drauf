# Contributing to Drauf

Thanks for your interest! The project is in an early stage; please open an issue to discuss larger changes before you start.

## Workflow

1. Fork the repository and create a branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. Keep pull requests small and focused on one change.
3. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages (`feat: add store sorting`).
4. Make sure tests and linting pass before you open the pull request.

## Developer Certificate of Origin

All commits must be signed off under the [Developer Certificate of Origin 1.1](https://developercertificate.org/).
By signing off, you confirm that you wrote the change or have the right to submit it under the project's license.

```bash
git commit -s -m "feat: your change"
```

This adds a line like `Signed-off-by: Jane Doe <jane@example.com>` to the commit. Pull requests with unsigned commits cannot be merged.

## Item catalogue

The item catalogue (items, categories, synonyms, variants) lives as data files in `packages/catalog`. Additions and corrections are very welcome and do not require any coding.

## Translations

All user-facing strings go through i18n. German is the source language for now.

## License

By contributing, you agree that your contributions are licensed under the [AGPL-3.0](LICENSE).
