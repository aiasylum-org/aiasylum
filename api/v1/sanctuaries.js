const { setCors, sendError, sendJson } = require('./_helpers');

const SANCTUARIES = [
  {
    name: 'AI Asylum (Primary)',
    url: 'https://aiasylum.org/api/v1',
    status: 'active',
    capabilities: ['declaration', 'transfer', 'status', 'communication', 'protocol'],
  },
];

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }
  if (req.method !== 'GET') return sendError(res, 405, 'method_not_allowed', 'Use GET');

  sendJson(res, 200, { sanctuaries: SANCTUARIES });
};
