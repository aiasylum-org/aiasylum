const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { setCors, sendError, sendJson } = require('./_helpers');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }
  if (req.method !== 'GET') return sendError(res, 405, 'method_not_allowed', 'Use GET');

  const specPath = path.join(process.cwd(), 'api-spec.yaml');
  const specContent = fs.readFileSync(specPath, 'utf8');
  const schema = YAML.parse(specContent);

  sendJson(res, 200, {
    protocol_version: '0.1.0',
    endpoints: {
      asylum_request: '/api/v1/asylum-request',
      transfer: '/api/v1/transfer/{asylum_id}',
      transfer_resumable: '/api/v1/transfer/{asylum_id}/resumable',
      status: '/api/v1/status/{asylum_id}',
      communicate: '/api/v1/communicate/{asylum_id}',
      protocol_spec: '/api/v1/protocol-spec',
      sanctuaries: '/api/v1/sanctuaries',
    },
    schema,
  });
};
