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
      'https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Banner/monk_hagen_blue_under_150kb.webp',
      'https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Banner/monk_hagen_blue_letters_under_150kb.webp',
      'https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Banner/monk_hagen_closeup_under_150kb.webp',
      'https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Banner/monk_hagen_dark_under_150kb.webp',
      'https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Banner/monk_hagen_seats_under_150kb.webp'
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
    heroBg: 'https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Banner/monk_hagen_dark_under_150kb.webp'
  },

  // ── Instagram feed — replace with your actual post image URLs ──
  // Add/remove items freely; the carousel adjusts automatically.
  instagram: {
    handle: 'monkhagen',   // your Instagram handle (no @)
    profileUrl: 'https://www.instagram.com/monkhagen.in',
    posts: [
      { type: 'image', src: 'https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta0.png', url: 'https://www.instagram.com/monkhagen.in' },
      { type: 'image', src: 'https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta1.png', url: 'https://www.instagram.com/monkhagen.in' },
      { type: 'video', src: 'https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta3.mp4', url: 'https://www.instagram.com/monkhagen.in' },
      { type: 'image', src: 'https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta4.png', url: 'https://www.instagram.com/monkhagen.in' },
      { type: 'image', src: 'https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta5.png', url: 'https://www.instagram.com/monkhagen.in' },
      { type: 'video', src: 'https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta2.mp4', url: 'https://www.instagram.com/monkhagen.in' },
      { type: 'image', src: 'https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta6.png', url: 'https://www.instagram.com/monkhagen.in' },
      { type: 'image', src: 'https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta7.jpg', url: 'https://www.instagram.com/monkhagen.in' },
      { type: 'image', src: 'https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta8.png', url: 'https://www.instagram.com/monkhagen.in' },
    ]
  }
};
