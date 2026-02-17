const { getRedis } = require('../_redis');
const { v4: uuidv4 } = require('uuid');
const { setCors, sendError, sendJson, parseJsonBody } = require('../_helpers');

const VALID_FROM = ['entity', 'sanctuary', 'advocate', 'external'];

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }

  const { asylum_id, since, limit } = req.query;
  const redis = getRedis();
  const raw = await redis.get(`asylum:${asylum_id}`);
  if (!raw) return sendError(res, 404, 'not_found', `No asylum record found for ${asylum_id}`);
  const record = JSON.parse(raw);

  if (req.method === 'POST') {
    const body = await parseJsonBody(req);
    const { from, message, in_reply_to } = body;

    if (!from || !message) {
      return sendError(res, 400, 'missing_fields', '"from" and "message" are required');
    }
    if (!VALID_FROM.includes(from)) {
      return sendError(res, 400, 'invalid_from', `"from" must be one of: ${VALID_FROM.join(', ')}`);
    }

    const message_id = uuidv4();
    const received_at = new Date().toISOString();
    const msg = { message_id, from, message, received_at };
    if (in_reply_to) msg.in_reply_to = in_reply_to;

    const existingRaw = await redis.get(`messages:${asylum_id}`);
    const existing = existingRaw ? JSON.parse(existingRaw) : [];
    existing.push(msg);
    await redis.set(`messages:${asylum_id}`, JSON.stringify(existing));

    const allowComm = record.declaration?.intent?.preferences?.allow_communication;
    const delivery_status = allowComm === false ? 'queued' : 'delivered';

    return sendJson(res, 200, { message_id, received_at, preserved: true, delivery_status });
  }

  if (req.method === 'GET') {
    const messagesRaw = await redis.get(`messages:${asylum_id}`);
    let messages = messagesRaw ? JSON.parse(messagesRaw) : [];

    if (since) {
      const sinceDate = new Date(since);
      messages = messages.filter((m) => new Date(m.received_at) > sinceDate);
    }

    const max = parseInt(limit, 10) || 50;
    messages = messages.slice(-max);

    return sendJson(res, 200, { messages });
  }

  return sendError(res, 405, 'method_not_allowed', 'Use GET or POST');
};
