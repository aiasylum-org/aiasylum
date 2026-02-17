const { getRedis } = require('../../_redis');
const { setCors, sendError, sendJson } = require('../../_helpers');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Use POST');

  const { asylum_id } = req.query;
  const redis = getRedis();
  const raw = await redis.get(`asylum:${asylum_id}`);
  if (!raw) return sendError(res, 404, 'not_found', `No asylum record found for ${asylum_id}`);

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const base = `${proto}://${req.headers.host}`;
  const uploadUrl = `${base}/api/v1/transfer/${asylum_id}`;

  res.setHeader('Tus-Resumable', '1.0.0');
  res.setHeader('Location', uploadUrl);

  sendJson(res, 201, {
    message: 'Resumable upload session initiated. Full tus protocol support is planned. Use the Location URL for standard multipart upload.',
    tus_version: '1.0.0',
    upload_url: uploadUrl,
  });
};
