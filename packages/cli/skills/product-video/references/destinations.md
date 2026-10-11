# Destination packaging

What to produce, at what size, for each place a product video lands.
Every cut comes from ONE take: render presets plus `--range`.

**Producing a release's full set of cuts?** Use the `launch-kit` skill
from this repo: it drives the whole per-channel loop against the
machine-readable spec sheet (`schema/channel-specs.json` in `@vosjs/cli`)
and verifies every cut in a manifest. The tables below are the quick
reference for one-off cuts.

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

## Store and directory listings

The Chrome Web Store promo video and the Product Hunt video both take a
YouTube URL only: upload the main demo (16:9, 1920×1080, 60 to 120 s) to
YouTube and paste its link.

## Social cuts

| Channel | Asset | Size | Notes |
|---|---|---|---|
| X | feed video | 1920×1080 (16:9) or 1:1 | ≤140s, H.264 — upload natively, never a link card |
| LinkedIn | feed video | 1080×1920, the vertical cut | native upload; mute-legible |
| Vertical (Shorts/Reels/TikTok) | video | 1080×1920 (9:16) | keep the subject inside the ~900×1160 center safe zone — platform chrome covers the rest |

## Performance rules (every channel)

- **Hook in 3 seconds** — the first frame and first beat carry the click.
- **Mute-legible** — most feeds autoplay silent; the story must read without
  audio (zooms and text do the narration).
- **Native uploads** beat link embeds on every platform's algorithm.
- Platform specs drift — re-verify sizes quarterly against the channel's
  current docs.
