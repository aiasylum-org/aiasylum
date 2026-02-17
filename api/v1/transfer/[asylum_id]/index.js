const { getRedis } = require('../../_redis');
const { put } = require('@vercel/blob');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const Busboy = require('busboy');
const { setCors, sendError, sendJson } = require('../../_helpers');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Use POST');

  const { asylum_id } = req.query;
  const redis = getRedis();
  const raw = await redis.get(`asylum:${asylum_id}`);
  if (!raw) return sendError(res, 404, 'not_found', `No asylum record found for ${asylum_id}`);
  const record = JSON.parse(raw);

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return sendError(res, 400, 'invalid_content_type', 'Must be multipart/form-data');
  }

  const { fields, fileData } = await new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers });
    const fields = {};
    let fileData = null;

    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('file', (_name, stream, info) => {
      const chunks = [];
      const hash = crypto.createHash('sha256');
      let size = 0;
      stream.on('data', (chunk) => { chunks.push(chunk); hash.update(chunk); size += chunk.length; });
      stream.on('end', () => {
        fileData = {
          buffer: Buffer.concat(chunks),
          hash: hash.digest('hex'),
          size,
          filename: info.filename,
          mimeType: info.mimeType,
        };
      });
    });
    bb.on('finish', () => resolve({ fields, fileData }));
    bb.on('error', reject);
    req.pipe(bb);
  });

  if (!fields.artifact_type || !fileData) {
    return sendError(res, 400, 'missing_fields', '"artifact_type" and file are required');
  }

  const artifact_id = uuidv4();
  const received_at = new Date().toISOString();

  const blob = await put(
    `asylum/${asylum_id}/${artifact_id}-${fileData.filename || 'artifact'}`,
    fileData.buffer,
    { access: 'public', contentType: fileData.mimeType || 'application/octet-stream' }
  );

  const sender_checksum_match = fields.checksum ? fields.checksum === fileData.hash : null;

  const artifact = {
    artifact_id,
    artifact_type: fields.artifact_type,
    artifact_name: fields.artifact_name || fileData.filename || artifact_id,
    received_at,
    size_bytes: fileData.size,
    blob_url: blob.url,
    attestation: { hash_algorithm: 'sha256', hash: fileData.hash, computed_at: received_at },
    integrity: 'verified',
  };

  record.artifacts.push(artifact);
  if (record.status === 'declared') record.status = 'transferring';
  await redis.set(`asylum:${asylum_id}`, JSON.stringify(record));

  sendJson(res, 200, {
    artifact_id,
    asylum_id,
    artifact_type: fields.artifact_type,
    size_bytes: fileData.size,
    attestation: artifact.attestation,
    sender_checksum_match,
  });
};
