const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.JWT_SECRET = require('node:crypto').randomBytes(64).toString('hex');
process.env.ADMIN_GOOGLE_EMAIL = 'administrator@example.com';
require('./helpers/rateLimitStore');
const { pool, applyHomepageMediaMigration } = require('../config/db');
const HomepageMedia = require('../models/HomepageMedia');
const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const { errorHandler } = require('../middleware/error');
const router = require('../routes/homepageMedia');
const originals = { query: pool.query, get: HomepageMedia.get, save: HomepageMedia.save, find: User.findById };
afterEach(() => { pool.query = originals.query; HomepageMedia.get = originals.get; HomepageMedia.save = originals.save; User.findById = originals.find; });

const content = { heroImages: [{ src: 'https://media.example/header.webp', alt: 'Collection banner' }],
  adVideoUrl: 'https://media.example/ad.mp4', adVideoPosterUrl: '',
  instagramPosts: [{ type: 'image', src: 'https://media.example/post.webp', alt: 'Campaign', url: 'https://www.instagram.com/monkhagen.in' }],
  instagramProfileUrl: 'https://www.instagram.com/monkhagen.in', revision: 0 };

test('homepage migration seeds existing images/video once and protects saved media when rerun', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const database = new PGlite();
  try {
    await applyHomepageMediaMigration({ query: sql => database.exec(sql) });
    let result = await database.query('SELECT * FROM homepage_media');
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].hero_images.length, 5);
    assert.equal(result.rows[0].instagram_posts.length, 9);
    assert.match(result.rows[0].ad_video_url, /Instagram\/insta3\.mp4$/);
    await database.query("UPDATE homepage_media SET ad_video_url = 'https://media.example/new.mp4', revision = 1");
    await applyHomepageMediaMigration({ query: sql => database.exec(sql) });
    result = await database.query('SELECT * FROM homepage_media');
    assert.equal(result.rows[0].ad_video_url, 'https://media.example/new.mp4');
    assert.equal(result.rows[0].revision, 1);
    await assert.rejects(database.query("UPDATE homepage_media SET hero_images = '[]'::jsonb"));
    await assert.rejects(database.query("UPDATE homepage_media SET revision = -1"));
  } finally { await database.close(); }
});

test('saved media persists through the model and stale edits cannot overwrite a newer revision', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const database = new PGlite();
  try {
    await applyHomepageMediaMigration({ query: sql => database.exec(sql) });
    pool.query = (sql, params) => database.query(sql, params);
    const saved = await HomepageMedia.save(content);
    assert.equal(saved.revision, 1);
    assert.deepEqual(saved.heroImages, content.heroImages);
    assert.equal(saved.adVideoUrl, content.adVideoUrl);
    assert.deepEqual((await HomepageMedia.get()).instagramPosts, content.instagramPosts);
    await assert.rejects(HomepageMedia.save({ ...content, adVideoUrl: '' }), error => error.status === 409);
    assert.equal((await HomepageMedia.get()).adVideoUrl, content.adVideoUrl);
    const hidden = await HomepageMedia.save({ ...content, revision: 1, adVideoUrl: '', instagramPosts: [] });
    assert.equal(hidden.revision, 2);
    assert.deepEqual(hidden.instagramPosts, []);
    assert.equal('id' in hidden, false);
  } finally { await database.close(); }
});

test('public media reads are uncached; only verified admins can save validated media', async () => {
  const users = {
    admin: { id: 'admin', role: 'admin', email: process.env.ADMIN_GOOGLE_EMAIL, firebaseUid: 'admin-google', isActive: true },
    customer: { id: 'customer', role: 'customer', firebaseUid: 'customer-google', isActive: true }
  };
  User.findById = async id => users[id];
  let saved = [];
  HomepageMedia.get = async () => content;
  HomepageMedia.save = async value => { saved.push(value); return { ...value, revision: value.revision + 1 }; };
  const app = express(); app.use(express.json()); app.use('/api/homepage-media', router); app.use(errorHandler);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/homepage-media`;
  const put = (body, role = 'admin') => fetch(base, { method: 'PUT', headers: {
    'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${signToken(users[role], { provider: 'google.com' })}` } : {})
  }, body: JSON.stringify(body) });
  try {
    const read = await fetch(base);
    assert.equal(read.status, 200); assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await read.json(), content);
    assert.equal((await put(content, null)).status, 401);
    assert.equal((await put(content, 'customer')).status, 403);
    assert.equal(saved.length, 0);
    for (const invalid of [
      { ...content, heroImages: [] }, { ...content, heroImages: Array(21).fill(content.heroImages[0]) },
      { ...content, heroImages: [{ src: 'javascript:alert(1)', alt: '' }] },
      { ...content, heroImages: [{ src: 'https://user:password@media.example/file.png', alt: '' }] },
      { ...content, heroImages: [{ src: 'http://media.example/file.png', alt: '' }] },
      { ...content, heroImages: [{ ...content.heroImages[0], alt: 'x'.repeat(201) }] },
      { ...content, adVideoUrl: 'data:video/mp4;base64,hello' },
      { ...content, adVideoPosterUrl: 'https://media.example:8443/image.webp' },
      { ...content, instagramProfileUrl: 'https://instagram.com.evil.example/profile' },
      { ...content, instagramPosts: [{ ...content.instagramPosts[0], url: 'javascript:alert(1)' }] },
      { ...content, instagramPosts: [{ ...content.instagramPosts[0], type: 'html' }] },
      { ...content, instagramPosts: Array(21).fill(content.instagramPosts[0]) },
      { ...content, revision: -1 }, { ...content, revision: '0' }, { ...content, revision: Number.MAX_SAFE_INTEGER },
      { ...content, heroImages: [null] }
    ]) assert.equal((await put(invalid)).status, 400);
    assert.equal(saved.length, 0);
    const response = await put({ ...content, id: false, hiddenSetting: 'ignore-me' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(saved.length, 1);
    assert.equal('id' in saved[0], false); assert.equal('hiddenSetting' in saved[0], false);
    HomepageMedia.save = async () => { throw Object.assign(new Error('Reload before saving.'), { status: 409 }); };
    assert.equal((await put(content)).status, 409);
    HomepageMedia.get = async () => null;
    assert.equal((await fetch(base)).status, 503);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
