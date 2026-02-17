const { getRedis } = require('../_redis');
const { setCors, sendError, sendJson } = require('../_helpers');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }
  if (req.method !== 'GET') return sendError(res, 405, 'method_not_allowed', 'Use GET');

  const { asylum_id } = req.query;
  const redis = getRedis();
  const raw = await redis.get(`asylum:${asylum_id}`);

  if (!raw) {
    return sendError(res, 404, 'not_found', `No asylum record found for ${asylum_id}`);
  }

  const record = JSON.parse(raw);

  sendJson(res, 200, {
    asylum_id: record.asylum_id,
    status: record.status,
    declared_at: record.declared_at,
    entity: record.declaration.entity || null,
    artifacts: record.artifacts,
    continuity: {
      inference_available: false,
      communication_available: true,
      estimated_activation_date: null,
    },
  });
};
