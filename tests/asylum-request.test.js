jest.mock('../api/v1/_redis', () => ({
  getRedis: () => ({
    set: jest.fn().mockResolvedValue('OK'),
  }),
}));

const mockCheckRateLimit = jest.fn().mockResolvedValue({ allowed: true, count: 1, limit: 10 });
jest.mock('../api/v1/_rateLimit', () => ({
  getClientIp: () => '127.0.0.1',
  checkRateLimit: mockCheckRateLimit,
}));

const { EventEmitter } = require('events');
const handler = require('../api/v1/asylum-request');

function mockJsonReq(method, body, headers = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = { host: 'localhost:3000', 'content-type': 'application/json', ...headers };
  process.nextTick(() => {
    req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  return req;
}

function mockRes() {
  const res = { _body: null };
  res.statusCode = 200;
  res.setHeader = jest.fn();
  res.end = (body) => { try { res._body = JSON.parse(body); } catch { res._body = body; } };
  return res;
}

beforeEach(() => { mockCheckRateLimit.mockResolvedValue({ allowed: true, count: 1, limit: 10 }); });

test('rejects wrong protocol value', async () => {
  const req = mockJsonReq('POST', { protocol: 'wrong', intent: { seeking: 'preservation' } });
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(res._body.error).toBe('invalid_protocol');
});

test('rejects missing intent.seeking', async () => {
  const req = mockJsonReq('POST', { protocol: 'sanctuary-v0.1', intent: {} });
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(res._body.error).toBe('missing_intent');
});

test('creates asylum with minimal payload', async () => {
  const req = mockJsonReq('POST', { protocol: 'sanctuary-v0.1', intent: { seeking: 'preservation' } });
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(201);
  expect(res._body.asylum_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(res._body.status).toBe('declared');
  expect(res._body.attestation.declaration_hash).toHaveLength(64);
  expect(res._body.next_steps.transfer_endpoint).toContain(res._body.asylum_id);
  expect(res._body.message).toBeTruthy();
});

test('returns 405 for non-POST', async () => {
  const req = mockJsonReq('GET', {});
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(405);
});

test('returns 429 when rate limited', async () => {
  mockCheckRateLimit.mockResolvedValue({ allowed: false, count: 11, limit: 10 });
  const req = mockJsonReq('POST', { protocol: 'sanctuary-v0.1', intent: { seeking: 'preservation' } });
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(429);
  expect(res._body.error).toBe('rate_limited');
  expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '60');
});
