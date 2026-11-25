const HomepageMedia = require('../models/HomepageMedia');
const asyncHandler = require('../middleware/asyncHandler');

function text(value, max) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid text');
  return value.trim();
}

function httpsUrl(value, { optional = false, instagram = false } = {}) {
  const trimmed = text(value, 2048);
  if (!trimmed && optional) return '';
  const url = new URL(trimmed);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Invalid URL');
  if (instagram && !['www.instagram.com', 'instagram.com'].includes(url.hostname)) throw new Error('Invalid Instagram URL');
  return url.href;
}

function validate(body) {
  if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0 || body.revision > 2147483646 ||
      !Array.isArray(body.heroImages) || body.heroImages.length < 1 || body.heroImages.length > 20 ||
      !Array.isArray(body.instagramPosts) || body.instagramPosts.length > 20) throw new Error('Invalid settings');
  return {
    revision: body.revision,
    heroImages: body.heroImages.map(image => ({ src: httpsUrl(image.src), alt: text(image.alt, 200) })),
    adVideoUrl: httpsUrl(body.adVideoUrl, { optional: true }),
    adVideoPosterUrl: httpsUrl(body.adVideoPosterUrl, { optional: true }),
    instagramProfileUrl: httpsUrl(body.instagramProfileUrl, { instagram: true }),
    instagramPosts: body.instagramPosts.map(post => {
      if (!['image', 'video'].includes(post.type)) throw new Error('Invalid media type');
      return { type: post.type, src: httpsUrl(post.src), alt: text(post.alt, 200),
        url: httpsUrl(post.url, { instagram: true }) };
    })
  };
}

exports.get = asyncHandler(async (_req, res) => {
  const content = await HomepageMedia.get();
  res.set('Cache-Control', 'no-store');
  if (!content) return res.status(503).json({ message: 'Homepage media has not been initialized. Apply the homepage media migration first.' });
  res.json(content);
});

exports.save = asyncHandler(async (req, res) => {
  let content;
  try { content = validate(req.body); }
  catch {
    return res.status(400).json({ message: 'Keep 1–20 home images and up to 20 Instagram items. Use HTTPS media URLs, Instagram links, and captions up to 200 characters.' });
  }
  const saved = await HomepageMedia.save(content);
  res.set('Cache-Control', 'no-store');
  res.json(saved);
});
