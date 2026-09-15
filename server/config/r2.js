const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { randomUUID } = require('crypto');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

const BUCKET = process.env.R2_BUCKET_NAME || 'monkhagen-media';
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'video/mp4'
]);

const EXT_MAP = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'video/mp4':  'mp4'
};

// Max 10 MB for images, 200 MB for video
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 200 * 1024 * 1024;

function maxSizeFor(mime) {
  return mime === 'video/mp4' ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
}

/**
 * Upload a buffer to R2.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} folder  e.g. "products/abc-uuid", "banners", "logos", "videos"
 * @returns {{ key: string, url: string }}
 */
async function uploadFile(buffer, mimeType, folder = 'products') {
  if (!ALLOWED_MIME.has(mimeType)) {
    const err = new Error(`Unsupported file type: ${mimeType}`);
    err.status = 400;
    throw err;
  }
  const max = maxSizeFor(mimeType);
  if (buffer.length > max) {
    const limit = mimeType === 'video/mp4' ? '200 MB' : '10 MB';
    const err = new Error(`File exceeds the ${limit} limit.`);
    err.status = 400;
    throw err;
  }

  const ext = EXT_MAP[mimeType];
  const key = `${folder}/${randomUUID()}.${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType
  }));

  const url = PUBLIC_URL ? `${PUBLIC_URL}/${key}` : key;
  return { key, url };
}

/**
 * Delete an object from R2 by its key or full public URL.
 * Silently ignores objects that do not exist.
 */
async function deleteFile(keyOrUrl) {
  if (!keyOrUrl) return;
  let key = keyOrUrl;
  if (PUBLIC_URL && keyOrUrl.startsWith(PUBLIC_URL + '/')) {
    key = keyOrUrl.slice(PUBLIC_URL.length + 1);
  }
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (err) {
    if (err.name !== 'NoSuchKey') throw err;
  }
}

module.exports = {
  s3, uploadFile, deleteFile, ALLOWED_MIME, MAX_IMAGE_SIZE, MAX_VIDEO_SIZE
};
