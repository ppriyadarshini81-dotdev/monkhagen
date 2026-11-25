# Homepage media management

Open **Admin → Homepage Media**, beside Products. This page manages:

1. The home header image carousel (1–20 pictures).
2. The ad/lookbook video beneath New Arrivals (one MP4 and an optional poster image).
3. The Instagram carousel (up to 20 images or MP4 clips, with descriptions and Instagram links).

Upload new media, replace an existing item, edit its URL/description, or move it up
and down. Uploads use the existing authenticated R2 API: images in `banners`, MP4
files in `videos`. Images are limited to 10 MB each, up to eight per upload; videos
to 200 MB, one per upload, subject to hosting request-size limits. The existing
upload rate limit applies. All uploaded files retain backend byte/type validation.

An upload changes the editor's draft. **Save changes** publishes all three sections
together. Removing an item removes its homepage reference; it does not delete its
R2 object or other references to that file. At least one header picture is required.
An empty ad video URL hides the ad section. An empty Instagram list hides the feed.
Use **Reload saved** to discard a draft, or **View homepage** to see published media.

## Deployment

Deploy the backend and frontend and apply migration **028_homepage_media** before
using the editor. Use the existing migration command with the designated migration
owner connection:

```text
npm run db:migrate
```

Do not change the restricted production application role to an owner. As for the
other application tables, the runtime role needs SELECT/UPDATE on `homepage_media`;
provision those privileges through the deployment's established role/default-grant
process. The application does not grant privileges or run this migration from an
HTTP request.

The migration creates one settings row seeded with the current five banners,
current ad video, and nine Instagram items. It does not alter products or customer
data. Re-running the migration never overwrites saved homepage settings.

`GET /api/homepage-media` exposes only public homepage settings and uses `no-store`.
`PUT /api/homepage-media` requires the existing verified administrator identity and
admin rate limit. Save requests include a revision; stale saves return 409 rather
than overwrite another admin's changes. Media URLs require HTTPS without credentials;
Instagram destinations must use instagram.com. URLs are stored, not fetched by the API.

The homepage fetches settings when opened. If settings are temporarily unavailable,
its existing media registry remains the fallback. There is no client-side settings
cache that could keep old images after a new visit. Existing tabs update on reload.

Tests use mocked HTTP/R2 and an isolated in-memory PostgreSQL-compatible database.
No production migrations, uploads, or homepage changes are performed by tests.
