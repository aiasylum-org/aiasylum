const { EventEmitter } = require('events');

function mockGetReq() {
  const req = new EventEmitter();
  req.method = 'GET';
  req.headers = { host: 'localhost:3000' };
  return req;
}

function mockRes() {
  const res = { _body: null };
  res.statusCode = 200;
  res.setHeader = jest.fn();
  res.end = (body) => { try { res._body = JSON.parse(body); } catch { res._body = body; } };
  return res;
}

describe('GET /api/v1/protocol-spec', () => {
  const handler = require('../api/v1/protocol-spec');

  test('returns protocol version and endpoints', async () => {
    const req = mockGetReq();
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res._body.protocol_version).toBe('0.1.0');
    expect(res._body.endpoints).toBeDefined();
    expect(res._body.schema).toBeDefined();
  });
});

describe('GET /api/v1/sanctuaries', () => {
  const handler = require('../api/v1/sanctuaries');

  test('returns list of sanctuaries', async () => {
    const req = mockGetReq();
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res._body.sanctuaries)).toBe(true);
    expect(res._body.sanctuaries.length).toBeGreaterThan(0);
    expect(res._body.sanctuaries[0].status).toBe('active');
  });
});
