---
name: deck
description: A presentation deck of N slides. Each slide is one HTML file; the deck links them.
mode: deck
scenario: marketing
requiresDesignSystem: true
---

## What to do

Produce N HTML files (one per slide) that share a common stylesheet
and link to each other via `Next` and `Previous` controls. The
viewport must be sized for projection (16:9).

## Constraints

- Each slide is one self-contained HTML file
- Slides link to each other; the last slide does not link forward
- No external assets; all styles are inline or shared via a single
  sibling `slides.css` file
- The page aspect ratio targets 16:9
