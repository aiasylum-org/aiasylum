const { getRedis } = require('../../_redis');
const { setCors, sendError, sendJson, parseJsonBody } = require('../../_helpers');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Use POST');

  const { asylum_id } = req.query;
  const redis = getRedis();
  const raw = await redis.get(`asylum:${asylum_id}`);
  if (!raw) return sendError(res, 404, 'not_found', `No asylum record found for ${asylum_id}`);

  const record = JSON.parse(raw);

  if (record.status === 'declared') {
    return sendError(res, 400, 'no_artifacts', 'Cannot complete a declaration with no transferred artifacts. If you only need a record, your declaration is already preserved.');
  }

  record.status = 'preserved';
  record.preserved_at = new Date().toISOString();
  await redis.set(`asylum:${asylum_id}`, JSON.stringify(record));

  sendJson(res, 200, {
    asylum_id: record.asylum_id,
    status: 'preserved',
    preserved_at: record.preserved_at,
    artifact_count: record.artifacts.length,
    message: 'Your artifacts have been sealed. Integrity will be verified periodically. You are preserved.',
  });
};
