---
name: hay
description: "The editorial proof sheet: white paper, charcoal type and forest-green emphasis."
colors:
  paper: "#fff"
  ink: "#17251c"
  muted: "#526058"
  green: "#085d38"
  green-hover: "#063e27"
  rule: "#d5ddd7"
  strong-rule: "#87978c"
typography:
  display:
    fontFamily: "Archivo, sans-serif"
    fontSize: "clamp(3.1rem, 7.4vw, 6rem)"
    fontWeight: 750
    lineHeight: 1.04
    letterSpacing: "-.035em"
  display-compact:
    fontFamily: "Archivo, sans-serif"
    fontSize: "clamp(2.65rem, 12.2vw, 4.5rem)"
    fontWeight: 750
    lineHeight: 1.04
    letterSpacing: "-.035em"
  headline:
    fontFamily: "Archivo, sans-serif"
    fontSize: "clamp(2rem, 4vw, 3rem)"
    fontWeight: 650
    lineHeight: 1.14
    letterSpacing: "-.025em"
  headline-compact:
    fontFamily: "Archivo, sans-serif"
    fontSize: "32px"
    fontWeight: 650
    lineHeight: 1.14
    letterSpacing: "-.025em"
  title:
    fontFamily: "Archivo, sans-serif"
    fontSize: "25px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-.015em"
  title-compact:
    fontFamily: "Archivo, sans-serif"
    fontSize: "23px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-.015em"
  body:
    fontFamily: "Archivo, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.55
  body-compact:
    fontFamily: "Archivo, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
  lead:
    fontFamily: "Archivo, sans-serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.5
  lead-compact:
    fontFamily: "Archivo, sans-serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Archivo, sans-serif"
    fontSize: "16px"
    fontWeight: 550
    lineHeight: 1.55
  control-label:
    fontFamily: "Archivo, sans-serif"
    fontSize: "14px"
    fontWeight: 550
    lineHeight: 1.55
  action:
    fontFamily: "Archivo, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.55
  caption:
    fontFamily: "Archivo, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  result:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.65
  table-value:
    fontFamily: "Archivo, sans-serif"
    fontSize: "23px"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  control: "3px"
spacing:
  detail: "8px"
  compact: "12px"
  row: "14px"
  text: "16px"
  group: "20px"
  inset: "24px"
  column-compact: "28px"
  gutter-medium: "32px"
  heading: "36px"
  column: "48px"
  section: "64px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.paper}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "13px 20px"
  button-primary-hover:
    backgroundColor: "{colors.green-hover}"
    textColor: "{colors.paper}"
  button-primary-compact:
    padding: "11px 15px"
  copy-button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.green}"
    typography: "{typography.control-label}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  copy-button-hover:
    backgroundColor: "{colors.green}"
    textColor: "{colors.paper}"
  text-link:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
  navigation:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
  result-list:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.result}"
  definition-result:
    textColor: "{colors.green}"
  evidence-table:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.table-value}"
    padding: "20px 16px"
---

# Design System: hay

## Overview

**Creative North Star: "The editorial proof sheet"**

The editorial proof sheet uses white paper, charcoal type and a single forest-green accent. Strong typography, aligned columns and fine rules give commands, matches and evidence the same visual seriousness.

The interface stays flat and readable. Native links, ordered lists, tables and video controls carry the content; motion is limited to anchor scrolling and the keyboard skip-link reveal.

**Key Characteristics:**

- One sans-serif family, with monospace reserved for literal code.
- Open rows and ruled sections rather than elevated cards.
- Complete reading order and evidence remain visible as columns stack.

This is a code-led record of the website, extracted from [landing.css](site/landing.css),
[index.html](index.html) and [landing.js](site/landing.js). The confirmed direction lives in
[the surface brief](docs/specs/editorial-landing/direction.md); product truth belongs in
[PRODUCT.md](PRODUCT.md). No generated comp or comp approval is implied.

## Colors

The palette combines clear white with green-tinted neutrals and one forest-green accent.
The frontmatter owns the exact values; names below describe their uses.

### Primary

- **Forest green** (`green`): actions, wordmark, emphasized headline, definition rows and hay scores.
- **Deep forest green** (`green-hover`): the primary installation link's hover fill.

### Neutral

- **White paper** (`paper`): page and copy-control background; text on filled green controls.
- **Charcoal ink** (`ink`): headings, prose and ordinary links.
- **Muted green-gray** (`muted`): paths, rank counters, captions, versions and explanatory notes.
- **Fine rule** (`rule`): repeated row dividers and quieter boundaries.
- **Strong rule** (`strong-rule`): section boundaries, command rules and copy-control borders.

**The One Accent Rule.** Use forest green for actionable links, primary controls and the ranked definition. Keep ordinary prose in charcoal and supporting context in muted green-gray.

## Typography

Archivo is the display and body family, with sans-serif fallback. The locally served variable
Latin font provides normal weights from regular through black (400–900), uses `font-display:
swap` and disables synthesized faces. Literal code uses the system monospace stack.

The large statement uses `display`; section headings use `headline`; article headings use
`title`. Introductory prose uses `lead`, ordinary prose `body`, navigation `label`, and small
supporting prose `caption`. The wordmark uses a compact black weight (900). Table values and
rank counters use tabular numerals. Paragraph measure is bounded (68ch), with a shorter lead
(55ch).

Compact variants apply at the narrow breakpoint. Result code also reduces (13px to 12px);
table values reduce (23px to 16px). Small text is context, not a substitute for the main labels.

**The One Family Rule.** Use Archivo for headings, prose, labels and numerals. Reserve monospace for commands and result text.

The font asset is [archivo-latin.woff2](site/assets/archivo-latin.woff2), attributed to the
Archivo Project Authors and licensed under the bundled [SIL Open Font License 1.1](site/assets/OFL.txt).
[Asset provenance](site/assets/SOURCES.md) records its upstream source and digest. There is
no runtime Google Fonts request.

## Layout

A centered sheet caps the outer width (1320px), including generous desktop gutters (48px).
Repeated section spacing and column gaps use the frontmatter rhythm. Desktop section
headings pair a fluid title with a narrower margin note (300px); proof lists are equal columns,
while article and installation rows give their detail column more room (1:1.4).

At the middle breakpoint (max-width: 1000px), gutters narrow (32px), the introductory action
area moves below the prose and parallel columns tighten. At the narrow breakpoint
(max-width: 700px), gutters narrow again (20px); proof, article, installation and film sections
stack. Navigation wraps to its own masthead row. The evidence table stays a table with all
four columns; its widths, padding and text sizes adapt.

Literal code wraps and permits long paths to break. Result rows use HTML ordered lists with
custom visual counters. A scrolled-to section gets breathing room (24px scroll margin).

**The Reading Order Rule.** Preserve the DOM reading order when columns stack. Keep both result lists and every evidence column available on small screens.

## Elevation & Depth

There are no box shadows, gradients or translucent surfaces in the implemented sheet.
Rules and white space establish grouping; stronger rules separate major sections from the
lighter row dividers. The film rests on a solid charcoal surface.

**The Flat Sheet Rule.** Use spacing, type and rules to separate content. Do not introduce shadows or floating surfaces into this world.

## Shapes

Controls have a small, quiet corner treatment through `rounded.control`. Content rows,
tables, command areas and the film retain square edges. Fine strokes (1px) carry boundaries.
Directional and copy symbols are inline SVG, with a consistent line treatment (1.65px) and
ordinary icon size (20px); caption icons are smaller (16px).

**The Quiet Corner Rule.** Keep sheets, rows, tables and media square. Apply the small control radius only to the implemented action and copy controls.

## Components

### Actions and copy controls

The installation action is a filled green link with white text. Hover deepens its fill and
preserves white text. Its touch height is generous (minimum 52px, or 48px on narrow layouts).
The copy control is an outlined white button; hover fills it green and turns its text white.
Plain text links remain recognizably underlined and use a generous target height (44px).

Keyboard focus uses an offset green outline (2px stroke, 5px offset). The skip link reveals
on focus, uses an ink outline and keeps white text on green during hover. Copy buttons begin
hidden and appear only when their command and feedback targets exist. While copying, the
control is disabled and faded (opacity .65); success or failure uses an adjacent polite status
message. The command remains selectable when JavaScript or clipboard access is unavailable.

### Navigation

The masthead combines a plain wordmark, muted release label and direct text navigation.
Navigation links gain an underline on hover and retain the shared focus treatment. Footer
navigation uses the same simple text language. Neither navigation area uses pills or a
decorative active-state surface.

### Ordered proof lists

The paired views use native ordered lists with visible numeric counters, paths and wrapping
monospace result text. Light rules separate rows. A definition earns green text and a green
bottom rule; the matched token is marked through weight rather than a colored rectangle.
The comparison's caption stays beside it. See the [actual fixture output](site/demo/expected-hay.txt).

### Evidence table

A native table carries explicit column and row headers, tabular values and quieter subordinate
details. Green identifies hay values; labels and columns supply the meaning. Fine row rules,
strong header separation and reduced narrow-layout density preserve the complete comparison.

### Command rows and film

Installation uses open two-column rows and selectable code between strong rules. Copy is an
adjacent enhancement, not a replacement for the command. The film uses native controls,
a poster, a reserved widescreen ratio (16:9), no autoplay and an adjacent caption. Its text
equivalent remains in the evidence table.

Anchor scrolling is smooth by default and becomes immediate under reduced-motion preference.
There are no timed entrance effects or control transitions.

## Do's and Don'ts

### Do:

- **Do** use the named color roles and loaded Archivo weights.
- **Do** distinguish literal code from prose through monospace and preserve readable wrapping.
- **Do** keep explanatory notes beside the evidence or interaction they explain.
- **Do** preserve native semantics, visible focus and the reduced-motion override.
- **Do** use inline SVG for the implemented directional and copy icons.

### Don't:

- **Don't** replace the white sheet with cream, off-white or gradient backgrounds.
- **Don't** add pill controls, decorative kickers or numbered section labels.
- **Don't** turn the proof lists, capability rows or evidence into floating cards.
- **Don't** hide result rows, table values or installation commands to simplify mobile layout.
- **Don't** autoplay the benchmark film or add decorative entrance animation.
