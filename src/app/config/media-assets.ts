// ============================================================
// Central media asset registry — Angular frontend.
// Swap any URL here to replace Unsplash / Coverr with
// your own Cloudflare R2 links.
// ============================================================

export const MEDIA = {

  // ── Hero section (home page) ──────────────────────────────
  hero: {
    videos: [
      'https://cdn.coverr.co/videos/coverr-a-woman-in-a-fashion-store-1573/1080p.mp4',
      'https://cdn.coverr.co/videos/coverr-walking-on-the-street-9438/1080p.mp4',
      'https://cdn.coverr.co/videos/coverr-a-man-in-a-denim-jacket-2999/1080p.mp4'
    ],
    posters: [
      'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1600&q=80',
      'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1600&q=80',
      'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1600&q=80'
    ]
  },

  // ── Home page section images ──────────────────────────────
  home: {
    editorialBg:     'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1800&q=80',
    categoryHoodies: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=1000&q=80',
    categoryTees:    'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=1000&q=80'
  },

  // ── About page ────────────────────────────────────────────
  about: {
    heroBg: 'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=1600&q=80'
  }
};
