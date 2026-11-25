-- Seed current storefront assets once; preserve any subsequent administrator changes.
CREATE TABLE IF NOT EXISTS homepage_media (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  hero_images JSONB NOT NULL CHECK (jsonb_typeof(hero_images) = 'array' AND jsonb_array_length(hero_images) BETWEEN 1 AND 20),
  ad_video_url TEXT NOT NULL DEFAULT '',
  ad_video_poster_url TEXT NOT NULL DEFAULT '',
  instagram_posts JSONB NOT NULL CHECK (jsonb_typeof(instagram_posts) = 'array' AND jsonb_array_length(instagram_posts) <= 20),
  instagram_profile_url TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO homepage_media (id, hero_images, ad_video_url, ad_video_poster_url, instagram_posts, instagram_profile_url)
VALUES (TRUE,
  '[{"src":"https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Banner/monk_hagen_blue_under_150kb.webp","alt":"Monk Hagen collection banner 1"},{"src":"https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Banner/monk_hagen_blue_letters_under_150kb.webp","alt":"Monk Hagen collection banner 2"},{"src":"https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Banner/monk_hagen_closeup_under_150kb.webp","alt":"Monk Hagen collection banner 3"},{"src":"https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Banner/monk_hagen_dark_under_150kb.webp","alt":"Monk Hagen collection banner 4"},{"src":"https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Banner/monk_hagen_seats_under_150kb.webp","alt":"Monk Hagen collection banner 5"}]'::jsonb,
  'https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta3.mp4', '',
  '[{"type":"image","src":"https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta0.png","url":"https://www.instagram.com/monkhagen.in","alt":"Monk Hagen on Instagram"},{"type":"image","src":"https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta1.png","url":"https://www.instagram.com/monkhagen.in","alt":"Monk Hagen on Instagram"},{"type":"video","src":"https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta3.mp4","url":"https://www.instagram.com/monkhagen.in","alt":"Monk Hagen on Instagram"},{"type":"image","src":"https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta4.png","url":"https://www.instagram.com/monkhagen.in","alt":"Monk Hagen on Instagram"},{"type":"image","src":"https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta5.png","url":"https://www.instagram.com/monkhagen.in","alt":"Monk Hagen on Instagram"},{"type":"video","src":"https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta2.mp4","url":"https://www.instagram.com/monkhagen.in","alt":"Monk Hagen on Instagram"},{"type":"image","src":"https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta6.png","url":"https://www.instagram.com/monkhagen.in","alt":"Monk Hagen on Instagram"},{"type":"image","src":"https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta7.jpg","url":"https://www.instagram.com/monkhagen.in","alt":"Monk Hagen on Instagram"},{"type":"image","src":"https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta8.png","url":"https://www.instagram.com/monkhagen.in","alt":"Monk Hagen on Instagram"}]'::jsonb,
  'https://www.instagram.com/monkhagen.in')
ON CONFLICT (id) DO NOTHING;
