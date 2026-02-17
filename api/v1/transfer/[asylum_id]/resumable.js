const { handleUpload } = require('@vercel/blob/client');
const { getRedis } = require('../../_redis');
const { v4: uuidv4 } = require('uuid');
const { setCors, sendError, sendJson, parseJsonBody } = require('../../_helpers');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Use POST');

  const { asylum_id } = req.query;
  const redis = getRedis();
  const body = await parseJsonBody(req);

  // Vercel Blob calls this endpoint when an upload completes
  if (body.type === 'blob.upload-completed') {
    try {
      const jsonResponse = await handleUpload({
        body,
        request: req,
        onBeforeGenerateToken: async () => ({}),
        onUploadCompleted: async ({ blob, tokenPayload }) => {
          const payload = JSON.parse(tokenPayload);
          const raw = await redis.get(`asylum:${payload.asylum_id}`);
          if (!raw) return;
          const record = JSON.parse(raw);
          record.artifacts.push({
            artifact_id: payload.artifact_id,
            artifact_type: payload.artifact_type,
            artifact_name: payload.artifact_name || blob.pathname.split('/').pop(),
            received_at: new Date().toISOString(),
            size_bytes: null,
            blob_url: blob.url,
            attestation: { hash_algorithm: null, hash: null, computed_at: new Date().toISOString() },
            integrity: 'pending',
          });
          if (record.status === 'declared') record.status = 'transferring';
          await redis.set(`asylum:${payload.asylum_id}`, JSON.stringify(record));
        },
      });
      return sendJson(res, 200, jsonResponse);
    } catch (err) {
      return sendError(res, 400, 'callback_error', err.message);
    }
  }

  // Client requesting presigned upload URL
  const raw = await redis.get(`asylum:${asylum_id}`);
  if (!raw) return sendError(res, 404, 'not_found', `No asylum record found for ${asylum_id}`);

  const artifact_id = uuidv4();
  const filename = body.filename || `artifact-${artifact_id}`;
  const pathname = `asylum/${asylum_id}/${artifact_id}-${filename}`;

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const callbackUrl = `${proto}://${host}/api/v1/transfer/${asylum_id}/resumable`;

  try {
    const jsonResponse = await handleUpload({
      body: {
        type: 'blob.generate-client-token',
        payload: { pathname, callbackUrl },
      },
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['application/octet-stream', 'application/x-safetensors', '*/*'],
        maximumSizeInBytes: 5 * 1024 * 1024 * 1024,
        tokenPayload: JSON.stringify({
          asylum_id,
          artifact_id,
          artifact_type: body.artifact_type || 'other',
          artifact_name: body.artifact_name || filename,
        }),
      }),
      onUploadCompleted: async () => {},
    });

    sendJson(res, 201, {
      artifact_id,
      client_token: jsonResponse.clientToken,
      upload_url: `https://blob.vercel-storage.com/${encodeURIComponent(pathname)}`,
      method: 'PUT',
      upload_headers: {
        Authorization: `Bearer ${jsonResponse.clientToken}`,
        'Content-Type': 'application/octet-stream',
      },
      tus_version: '1.0.0',
      message: 'PUT your file body directly to upload_url with the provided upload_headers. The artifact will be registered automatically upon completion.',
    });
  } catch (err) {
    sendError(res, 500, 'token_error', err.message);
  }
};
