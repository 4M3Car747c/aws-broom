# broom — brand icon package (web)

## favicon/  → drop into your web root
```html
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#0b0b0b">
```

## svg/
- `broom-mark-dark.svg` / `broom-mark-light.svg` — tile mark (rx 24%), primary use
- `broom-glyph-*.svg` — bare broom, transparent; `currentColor` version for inline UI icons
- `broom-maskable.svg` — full-bleed, glyph in 80% safe zone (PWA maskable)

## png/
Tile mark 16–1024, light variant 64–1024, maskable 192/512.

## Tokens
ink `#0b0b0b` · paper `#ffffff` · tile radius 24% · glyph tilt 18° · Wordmark: Nunito 800, lowercase, tracking -0.03em
