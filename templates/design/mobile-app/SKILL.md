---
name: mobile-app
description: A mobile-first single-page app shell with a header, a list, and a tab bar.
mode: prototype
scenario: product
requiresDesignSystem: true
---

## What to do

Produce a single HTML file that looks like a mobile app on a phone.
The viewport meta tag must claim a small screen, and the layout must
not exceed 480 CSS pixels in width by default.

## Constraints

- Use `viewport` meta tag with `width=device-width`
- A header at the top, a list in the middle, a tab bar at the bottom
- Tap targets are at least 44x44 CSS pixels
- No third-party fonts
