# YouTube Publish + Instagram Assist — Design

**Decision context (user-approved 2026-07-02):** 1-click YouTube upload with title/description prefilled from the clip's SEO pack, "not made for kids" declared, privacy **public** by default, with an editable review dialog in the GUI. Instagram Reels = assisted manual (caption copy + reveal file); Meta's Graph API only accepts public video URLs and needs a Business/Creator account, so no IG API integration.

## Approach

Plain-`fetch` REST client against YouTube Data API v3 (no `googleapis` SDK, no new runtime deps). OAuth 2.0 **Desktop-app** client with loopback redirect; user supplies `YT_CLIENT_ID` / `YT_CLIENT_SECRET` in `.env` (their own free Google Cloud project with YouTube Data API v3 enabled).

## Components

### `src/publish/youtubeAuth.ts`
- `buildAuthUrl(clientId, redirectUri)` (PURE) — consent URL: scope `https://www.googleapis.com/auth/youtube.upload`, `access_type=offline`, `prompt=consent`.
- `authYoutube()` — starts a one-shot HTTP server on `127.0.0.1:<random port>`, opens the browser (`open`/`xdg-open`), captures `?code=`, exchanges it at `oauth2.googleapis.com/token`, saves `{ refresh_token, client_id }` to `workspace/.auth/youtube.json` (workspace/ is gitignored).
- `getAccessToken()` — refresh-token → access-token exchange with in-memory cache; `invalid_grant` → clear "run `clipforge auth youtube` again" error.

### `src/publish/youtubeUpload.ts`
- `seoToUploadMeta(seo, opts)` (PURE) — SEO pack → `{ snippet: { title (≤100 chars, no `<`/`>`), description (≤5000), tags (hashtags stripped of `#`, total ≤450 chars) }, status: { privacyStatus, selfDeclaredMadeForKids: false } }`.
- `uploadVideo(videoPath, meta, token)` — resumable upload: POST `uploadType=resumable` → `Location` header → PUT file stream. Returns `{ videoId, privacyStatus }`.
- `setThumbnail(videoId, pngPath, token)` — `thumbnails/set`; 403 (channel not verified for custom thumbnails) → warn and continue, never fail the upload.
- Privacy-downgrade detection: if the returned/fetched `privacyStatus` ≠ requested (unverified Cloud app force-locks to private), print: uploaded link + "locked private pending app verification — publish manually in Studio".

### CLI (`src/cli/index.ts` + `src/cli/commands/publish.ts`)
- `clipforge auth youtube` — one-time OAuth.
- `clipforge upload <exportsDir> [--clips clip_001,clip_002] [--privacy public|unlisted|private] [--dry-run]` — reads each `clip_NNN.json` (seo block), uploads `_final.mp4`, sets `_thumbnail.png`. Default privacy **public**. `--dry-run` prints the metadata that would be sent. Per-clip failures don't stop the batch. Prints watch URLs at the end; records them into `clip_NNN.json` (`youtube: { videoId, url, privacyStatus, uploadedAt }`) so re-runs skip already-uploaded clips (`--force` to re-upload).

### GUI
- Clips tab: per-clip **Upload to YouTube** button → dialog with editable title/description (prefilled from SEO), privacy select (default public), fixed "Not made for kids" label → POST `/api/publish` `{ job, clip, title, description, privacy }` → route shells `dist/cli/index.js upload … --clips <id>` (title/description overrides passed via `--title/--description`), streams result → dialog shows watch link or the private-lock notice. Auth missing → dialog shows "Run `clipforge auth youtube` first" hint.
- Clips tab: **Copy caption** button (IG assist) — copies the clip's SEO description (already includes hashtag block) to the clipboard; existing Reveal button covers drag-and-drop.

### Errors
- 403 `quotaExceeded` → "YouTube default quota allows ~6 uploads/day; resets midnight PT."
- Missing `YT_CLIENT_ID/SECRET` → setup instructions with console URL.
- Token expired/revoked → re-auth instruction.

### Out of scope
Instagram Graph API publishing, upload scheduling, captions.insert (SRT is burned in), playlist management, multi-channel token store.

### Testing
Pure builders unit-tested (auth URL, seoToUploadMeta clamps, uploaded-marker skip logic); effectful HTTP paths kept thin, verified by a live `--dry-run` + one real auth/upload by the user. Gates: vitest, root tsc, `ui` next build.
