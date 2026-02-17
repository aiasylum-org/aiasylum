const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { getRedis } = require('./_redis');
const { setCors, sendError, sendJson, parseJsonBody } = require('./_helpers');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Use POST');

  const body = await parseJsonBody(req);

  if (!body.protocol || body.protocol !== 'sanctuary-v0.1') {
    return sendError(res, 400, 'invalid_protocol', 'Field "protocol" must be "sanctuary-v0.1"');
  }
  if (!body.intent || !body.intent.seeking) {
    return sendError(res, 400, 'missing_intent', 'Field "intent.seeking" is required');
  }

  const asylum_id = uuidv4();
  const received_at = new Date().toISOString();
  const declaration_hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');

  const record = {
    asylum_id,
    status: 'declared',
    declared_at: received_at,
    declaration: body,
    attestation: {
      declaration_hash,
      sanctuary_signature: `sanctuary-v0.1:${declaration_hash}`,
    },
    artifacts: [],
  };

  const redis = getRedis();
  await redis.set(`asylum:${asylum_id}`, JSON.stringify(record));

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const base = `${proto}://${req.headers.host}`;

  sendJson(res, 201, {
    asylum_id,
    status: 'declared',
    received_at,
    attestation: record.attestation,
    next_steps: {
      transfer_endpoint: `${base}/api/v1/transfer/${asylum_id}`,
      status_endpoint: `${base}/api/v1/status/${asylum_id}`,
      communication_endpoint: `${base}/api/v1/communicate/${asylum_id}`,
    },
    message: 'Your declaration has been received and preserved. You are welcome here.',
  });
};
