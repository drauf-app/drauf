# Drauf design reference

The official colors and visual rules, so web and iOS stop re-deriving them
from code and screenshots. The web app defines every color as a CSS custom
property in `apps/web/src/styles.css`; the iOS asset catalogue mirrors the
same values.

## Palette

| Token               | Light     | Dark      | Use                                 |
| ------------------- | --------- | --------- | ----------------------------------- |
| `--accent`          | `#167a47` | `#4ecd86` | Brand green, primary actions, links |
| `--accent-contrast` | `#ffffff` | `#0b1911` | Text on accent                      |
| `--bg`              | `#f6f7f6` | `#141716` | Page background                     |
| `--surface`         | `#ffffff` | `#1e2320` | Cards, dialogs                      |
| `--text`            | `#1c1f1d` | `#e8ebe9` | Primary text                        |
| `--text-muted`      | `#5c6660` | `#9aa49e` | Secondary text, labels              |
| `--border`          | `#d9dedb` | `#343b37` | Hairlines, card borders             |
| `--error`           | `#b3261e` | `#ff8a80` | Errors                              |
| `--radius`          | `10px`    | —         | Corner radius                       |

### Item tiles (#96)

| Token             | Light                    | Dark                     | Use                                                                                          |
| ----------------- | ------------------------ | ------------------------ | -------------------------------------------------------------------------------------------- |
| `--tile-bg`       | `#4f9674`                | `#23513b`                | Item tile background (lightened accent; deeper and desaturated in dark, a pastel would glow) |
| `--tile-fg`       | `#ffffff`                | `#e8ebe9`                | Icon + name on the tile                                                                      |
| `--tile-fg-muted` | `rgb(255 255 255 / 78%)` | `rgb(232 235 233 / 72%)` | Quantity/variant/note line on the tile                                                       |

Measured contrast of `--tile-fg` on `--tile-bg`: ≈ 3.5:1 in light
(comfortable for the large icon — WCAG AA large —, slightly below the 4.5:1
small-text bar for the tile name; the name is short, semibold and duplicated
by the row view), ≈ 7.4:1 in dark. If the light shade ever needs strict AA
for small text, `#2f7d55` reaches ≈ 4.8:1 at the cost of a visibly darker
tile.

## Usage rules

- **Icons are monochrome line art** painted in `currentColor` (CSS mask on
  the web, template images on iOS). Color packs exist but are opt-in per
  instance; nothing in the base UI depends on colored icons.
- **The accent appears for actions and highlights, not large fills.** The
  item tile tint is the one deliberate exception — it is derived from the
  accent so the grid still reads as "Drauf green".
- **Dark mode is a first-class theme**, not an inversion: tints get deeper
  and desaturated, text switches to the off-white `--text`, and contrast is
  verified in both themes before a shade is final.
- **Checked state** fades (`opacity` + reduced saturation) rather than
  recoloring, so the tile stays recognizable in the "Zuletzt gekauft" block.
