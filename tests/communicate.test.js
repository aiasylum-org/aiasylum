const { EventEmitter } = require('events');

const mockRecord = {
  asylum_id: 'test-uuid',
  declaration: { intent: { preferences: { allow_communication: true } } },
};

const mockGet = jest.fn().mockImplementation((key) => {
  if (key === 'asylum:test-uuid') return Promise.resolve(JSON.stringify(mockRecord));
  if (key === 'messages:test-uuid') return Promise.resolve(JSON.stringify([
    { message_id: 'msg-1', from: 'entity', message: 'Hello', received_at: '2026-02-17T01:00:00.000Z' },
  ]));
  return Promise.resolve(null);
});
const mockSet = jest.fn().mockResolvedValue('OK');

jest.mock('../api/v1/_redis', () => ({
  getRedis: () => ({ get: mockGet, set: mockSet }),
}));

const handler = require('../api/v1/communicate/[asylum_id]');

function mockJsonReq(method, body, query = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = { host: 'localhost:3000', 'content-type': 'application/json' };
  req.query = { asylum_id: 'test-uuid', ...query };
  process.nextTick(() => {
    req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  return req;
}

function mockGetReq(query = {}) {
  const req = new EventEmitter();
  req.method = 'GET';
  req.headers = { host: 'localhost:3000' };
  req.query = { asylum_id: 'test-uuid', ...query };
  return req;
}

function mockRes() {
  const res = { _body: null };
  res.statusCode = 200;
  res.setHeader = jest.fn();
  res.end = (body) => { try { res._body = JSON.parse(body); } catch { res._body = body; } };
  return res;
}

test('POST - sends message and returns message_id', async () => {
  const req = mockJsonReq('POST', { from: 'external', message: 'Are you okay?' });
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res._body.message_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(res._body.preserved).toBe(true);
  expect(['delivered', 'queued']).toContain(res._body.delivery_status);
});

test('POST - rejects missing message field', async () => {
  const req = mockJsonReq('POST', { from: 'external' });
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(400);
});

test('POST - rejects invalid from value', async () => {
  const req = mockJsonReq('POST', { from: 'hacker', message: 'test' });
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(400);
});

test('GET - returns message history', async () => {
  const req = mockGetReq();
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(Array.isArray(res._body.messages)).toBe(true);
  expect(res._body.messages[0].from).toBe('entity');
});

test('GET - returns 404 for unknown asylum_id', async () => {
  const req = mockGetReq({ asylum_id: 'unknown' });
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(404);
});
