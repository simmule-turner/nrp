# News Reader PWA (NRP) — Requirements

## 1. Overview
NRP is a minimal, installable, offline-capable Progressive Web App, written in
JavaScript, acting as a client to a self-hosted Miniflux instance, with
optional save-to-Wallabag support.

## 2. Architecture Constraints
- **Two files only:**
  - `index.html` — contains all markup, inline CSS, inline JS, and an inline
    Web App Manifest (as a `data:` URI on `<link rel="manifest">`), plus
    inline SVG/data-URI icons.
  - `sw.js` — the Service Worker. This must be a real, separately-fetchable
    file (service workers cannot be registered from an inline/data URI), so
    it is the one unavoidable second file.
- **Offline-complete:** once configured and synced, the app must be fully
  usable with no network: browsing feeds, reading articles, viewing cached
  images, marking read/unread/starred, and queuing Wallabag sends all work
  offline. The Service Worker precaches the app shell (`index.html` itself);
  all article/image data lives in IndexedDB.
- **Storage layers:**
  - `localStorage` — configuration only (Miniflux/Wallabag credentials,
    display prefs, selected-feed IDs). Stored **in plaintext**, per your
    instruction. *(Flagging once: this is readable by any script that can
    run in the page's origin — acceptable for a personal self-hosted tool,
    but worth knowing.)*
  - `IndexedDB` — feeds, entries/articles, and the asset (image) cache,
    plus an outbox queue for actions taken offline.

## 3. Configuration Screen

### 3.1 Miniflux
| Field | Notes |
|---|---|
| `MINIFLUX_URL` | Base URL of the Miniflux instance |
| `MINIFLUX_TOKEN` | Miniflux API token |
| `MINIFLUX_MAX_ITEMS` | Max entries fetched **per feed, per sync** (not a lifetime cap) |

A "Manage Feeds" action fetches the full feed list live from Miniflux and
presents a checklist; the user selects which feeds are active. **Feeds are
stored and referenced internally by Miniflux feed ID**, not title (titles
can collide or be renamed). Only display names are shown in the UI.

### 3.2 Wallabag
| Field |
|---|
| Base URL |
| Client ID |
| Client Secret |
| Username |
| Password |

Used to perform the OAuth2 password-grant flow; access/refresh tokens are
cached in `localStorage` (plaintext) and refreshed automatically on expiry.

### 3.3 Display & Behavior Settings
1. **Always show images** — on/off. When off, images are not fetched at all
   (not even cached) until explicitly opened.
2. **Image caching mode** — `all` (pre-fetch every image for a synced entry
   immediately) or `on-read` (fetch/cache only when the entry is opened).
3. **Color scheme** — two color pickers, **Background** and **Foreground**.
   Two presets ("Dark", "Light") populate these as a starting point; there
   is no separate dark/light toggle — the picker *is* the theme mechanism.
4. **Startup mode** — either a specific feed (chosen from the selected-feed
   list) or the Feed List screen, as the screen shown on launch.
5. **Article List display density** — `text only` / `text + small image` /
   `text + large image`.
6. **Article list preview lines (`x`)** — integer config; the article list
   shows the title line plus `x − 1` lines of body preview per item before
   truncating. Default: `x = 3`.
7. **Cache size limit** — user-selectable between **100 MB and 5 GB**.
8. **Max individual cached item size** — configurable, **default 2 MB**.
   Items larger than this are not cached (article text still stores; an
   oversized image is left un-cached and fetched live if online).

## 4. Feed List Screen
- Shows each selected feed's **name** and **unread article count** (default
  interpretation of "number of articles" — flagged below as an assumption).
- Sortable by **name** or **count**, each ascending/descending.
- **Pull-to-refresh**: re-syncs every selected feed (fetch up to
  `MINIFLUX_MAX_ITEMS` new entries each) and refreshes unread counts.
- Selecting a feed opens its Article List.
- Deselecting/removing a feed purges its entries and cached images from
  IndexedDB (starred items are the one exception — see below).

## 5. Article List Screen (per feed)
- Filter tabs: **Unread / All / Starred**.
  - Starred items are exempt from any eviction or feed-removal purge and
    persist in the repository regardless of other cache pressure.
- Sort by **Date** (newest/oldest) or **Size** (smallest/largest, based on
  stored content byte size).
- Each row: title + `x − 1` preview lines, and (per display-density setting)
  no image / small thumbnail / large thumbnail.

## 6. Article View Screen
- Full content rendered from cache; scrollable.
- **Tap/click the header/title** → opens the original article URL
  (`entry.url`) in a new tab.
- **Tap/click an image** → opens the entry's **enclosure link** if one
  exists (the pattern used by Reddit-style feeds, where the enclosure
  points at the full-size image/source distinct from the article body);
  falls back to the article's origin URL if no enclosure is present.
- Opening an article marks it **read**; an explicit control allows
  **unmarking as read**. Both actions sync to Miniflux (`PUT` on the entry
  status) when online, or are queued in the offline outbox when not.
- A **"Send to Wallabag"** action posts `title` + `content` (rendered HTML,
  matching how Miniflux exposes entry content) + the original `url` to the
  Wallabag `/api/entries` endpoint. Failures while offline are queued and
  retried on reconnect.

## 7. Sync & Offline Behavior
- All state-changing actions (read/unread, star/unstar, Wallabag send) go
  through a local **outbox queue** in IndexedDB; queued items are replayed
  against Miniflux/Wallabag in order once connectivity returns.
- On Miniflux unreachable: app serves entirely from cache, with a small
  status indicator (not a blocking error).
- On auth failure (401 from Miniflux or Wallabag): surface a clear prompt
  to re-enter credentials on the Configuration screen; do not silently drop
  queued actions.

## 8. Cache Management (Assets/Images)
- Images are stored in IndexedDB as blobs, keyed by URL, with LRU metadata
  (last-accessed timestamp).
- When a new item would exceed the configured cache size limit, the
  **least-recently-used** cached image(s) are evicted until space is
  available — starred-article images are excluded from eviction.
- On a cache write failure for an image, the app falls back to fetching the
  original image live (network permitting) rather than failing the view.
- Any single asset over the configurable max item size (default 2 MB) is
  never cached, and is instead always fetched live when displayed.

## 9. Assumptions / Open Questions Flagged for Confirmation
1. **"Number of articles" on the Feed List** — assumed to mean **unread
   count**. If you intended *total* article count instead (or both, e.g.
   "12 unread / 340 total"), let me know.
2. **Wallabag "like Miniflux does"** — assumed to mean sending the rendered
   HTML content Miniflux already stores for the entry, not re-fetching/
   re-parsing the original page. Confirm this matches your intent.
3. **Startup sync trigger** — beyond pull-to-refresh, is there an expected
   periodic background sync (e.g., via `periodicSync` / a timer while the
   app is open), or is refresh strictly manual (pull-to-refresh + on
   selecting a feed for the first time)? Currently assumed **manual only**.
4. **PWA installability basics** (icons, `start_url`, `display: standalone`)
   are assumed required even though not explicitly stated — standard for
   any PWA — and will be embedded inline per the 2-file constraint.

---
This should be sufficient to start implementation. The four flagged items
in Section 9 are the only remaining ambiguities I'd want a quick answer on
before writing code — everything else in this document has a stated,
concrete default.
