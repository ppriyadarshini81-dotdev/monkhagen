const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { randomUUID } = require('crypto');
const { createReadStream } = require('node:fs');
const { stat } = require('node:fs/promises');

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
  if (!Buffer.isBuffer(buffer)) throw Object.assign(new Error('Invalid upload.'), { status: 400 });
  const { fileTypeFromBuffer } = await import('file-type');
  let detected;
  try { detected = await fileTypeFromBuffer(buffer); } catch {}
  validateUpload(detected?.mime, mimeType, buffer.length, folder);
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

function validateUpload(detectedMime, declaredMime, size, folder) {
  if (!ALLOWED_MIME.has(detectedMime) || detectedMime !== declaredMime) {
    throw Object.assign(new Error('File content does not match a supported image or MP4 type.'), { status: 400 });
  }
  if (!Number.isSafeInteger(size) || size < 1 || size > maxSizeFor(detectedMime)) {
    throw Object.assign(new Error('File exceeds the permitted upload size.'), { status: 413 });
  }
  const defectFolder = /^ReturnDefectiveItem\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(folder);
  if ((!['products','banners','logos','videos','reviews'].includes(folder) && !defectFolder) || (detectedMime === 'video/mp4') !== (folder === 'videos')) {
    throw Object.assign(new Error('Select the appropriate image or video upload folder.'), { status: 400 });
  }
}

async function uploadPath(file, folder = 'products') {
  const { fileTypeFromFile } = await import('file-type');
  let detected;
  try { detected = await fileTypeFromFile(file.path); } catch {}
  const info = await stat(file.path);
  validateUpload(detected?.mime, file.mimetype, info.size, folder);
  const key = `${folder}/${randomUUID()}.${EXT_MAP[detected.mime]}`;
  const body = createReadStream(file.path);
  try {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentLength: info.size,
      ContentType: detected.mime, CacheControl: 'public, max-age=31536000, immutable',
      ContentDisposition: detected.mime === 'video/mp4' ? 'attachment' : 'inline' }));
  } finally { body.destroy(); }
  return { key, url: PUBLIC_URL ? `${PUBLIC_URL}/${key}` : key };
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
  // Never reinterpret a foreign URL, arbitrary filename or unrelated bucket
  // prefix as an object deletion target. Manual/imported assets are retained.
  if (!/^(products|banners|logos|videos|reviews)\/[0-9a-f-]{36}\.(jpg|png|webp|avif|mp4)$/.test(key) &&
      !/^ReturnDefectiveItem\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|avif)$/.test(key)) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (err) {
    if (err.name !== 'NoSuchKey') throw err;
  }
}

module.exports = {
  s3, uploadFile, uploadPath, validateUpload, deleteFile, ALLOWED_MIME, MAX_IMAGE_SIZE, MAX_VIDEO_SIZE
};
