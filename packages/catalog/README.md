# Drauf item catalogue

The German base catalogue for quick-add suggestions: everyday grocery items
with their shopping category, common synonyms, an emoji icon, and the size and
variety chips shown when adding the item.

Licensed under [CC BY-SA 4.0](LICENSE) — contributions very welcome and
require no coding.

## Format

One JSON file per shopping category in `data/`, named after the category key
(e.g. `data/fruit-vegetables.json`). Each file is an array of items:

```json
{
  "name": "Nudeln",
  "synonyms": ["Pasta"],
  "icon": "🍝",
  "sizes": ["500 g", "1 kg"],
  "varieties": ["Spaghetti", "Fusilli", "Penne", "Farfalle"]
}
```

- `name` — the common German name, singular or plural as people say it.
- `synonyms` (optional) — alternative names people type, incl. regional terms.
- `icon` — a single emoji.
- `sizes` (optional) — typical package sizes, each parseable as `<number> <unit>`.
- `varieties` (optional) — the variety chips (e.g. pasta shapes, apple sorts).

Names and synonyms must be unique across the whole catalogue (case- and
whitespace-insensitive); the tests in this package enforce that and the rest
of the format.
