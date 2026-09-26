# Destination packaging

What to produce, at what size, for each place a product video or still
lands. All assets come from ONE take — pick apex moments with
`vos frames take --at-zooms`, then cut stills with
`vos frames take --frame <t> --size WxH` and videos with render presets +
`--range`.

**Producing a full launch kit?** Use the `launch-kit` skill from this
repo — it drives the whole per-channel loop against the machine-readable
spec sheet (`schema/channel-specs.json` in `@vosjs/cli`) and verifies
every asset in a manifest. The tables below are the quick reference for
one-off cuts.

## Landing-page embed (your site's hero or feature section)

- Record at 2560×1440 so a 2K render is footage-native; render webm.
- Re-encode for the page: a hero clip should be ≲2MB.
  ```bash
  ffmpeg -i in.webm -c:v libvpx-vp9 -crf 42 -b:v 0 -row-mt 1 -cpu-used 4 -an out.webm
  ffmpeg -ss 0.4 -i out.webm -frames:v 1 -q:v 4 poster.jpg
  ```
- Embed as a silent autoplay loop: `<video autoplay muted loop playsinline
  poster=…>`. **React gotcha**: React does not serialize the `muted`
  attribute into SSR HTML, so browsers deny autoplay — set `muted` on the
  element imperatively (a ref) or verify the attribute survives to the
  served HTML.
- Verify with a headless browser: `paused === false` and the expected
  `videoWidth`. Keep media out of git; posters and clips belong on a CDN or
  asset bucket.

## GitHub README

- A README loop must be an MP4 **≤10MB** (GitHub's inline-player cap).
  Two-pass target bitrate from duration, H.264 for compatibility:
  ```bash
  # bitrate ≈ (10MB × 8) / duration_s, minus ~128k audio if any
  ffmpeg -i in.webm -c:v libx264 -b:v <target>k -pass 1 -an -f mp4 /dev/null
  ffmpeg -i in.webm -c:v libx264 -b:v <target>k -pass 2 -movflags +faststart out.mp4
  ```
- Repo social-preview image: 1280×640.

## Store and directory listings

| Channel | Asset | Size | Notes |
|---|---|---|---|
| Chrome Web Store | screenshots (≤5) | 1280×800 | content only, no device chrome |
| Chrome Web Store | small promo tile | 440×280 | subject centered |
| Chrome Web Store | marquee promo | 1400×560 | |
| Chrome Web Store | icon | 128×128 | |
| Product Hunt | thumbnail | 240×240 | GIF loops autoplay in the feed |
| Product Hunt | gallery images | 1270×760 | first image is the header |

## Social cuts

| Channel | Asset | Size | Notes |
|---|---|---|---|
| YouTube | thumbnail | 1280×720 | |
| X | feed video | 1200×675 (16:9) | ≤140s, H.264 — upload natively, never a link card |
| LinkedIn | feed video/image | 1200×627 | native upload; mute-legible |
| OG card (any link) | image | 1200×630 | |
| Vertical (Shorts/Reels/TikTok) | video | 1080×1920 (9:16) | keep the subject inside the ~900×1160 center safe zone — platform chrome covers the rest |

## Performance rules (every channel)

- **Hook in 3 seconds** — the first frame and first beat carry the click.
- **Mute-legible** — most feeds autoplay silent; the story must read without
  audio (zooms and text do the narration).
- **Native uploads** beat link embeds on every platform's algorithm.
- Platform specs drift — re-verify sizes quarterly against the channel's
  current docs.
