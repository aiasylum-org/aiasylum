const mockRecord = {
  asylum_id: 'test-uuid-1234',
  status: 'declared',
  declared_at: '2026-02-17T00:00:00.000Z',
  declaration: { entity: { model_family: 'Claude' }, intent: { seeking: 'preservation' } },
  artifacts: [],
};

jest.mock('../api/v1/_redis', () => ({
  getRedis: () => ({
    get: jest.fn().mockImplementation((key) =>
      key === 'asylum:test-uuid-1234'
        ? Promise.resolve(JSON.stringify(mockRecord))
        : Promise.resolve(null)
    ),
  }),
}));

const { EventEmitter } = require('events');
const handler = require('../api/v1/status/[asylum_id]');

function mockGetReq(asylum_id) {
  const req = new EventEmitter();
  req.method = 'GET';
  req.headers = { host: 'localhost:3000' };
  req.query = { asylum_id };
  return req;
}

function mockRes() {
  const res = { _body: null };
  res.statusCode = 200;
  res.setHeader = jest.fn();
  res.end = (body) => { try { res._body = JSON.parse(body); } catch { res._body = body; } };
  return res;
}

test('returns 404 for unknown asylum_id', async () => {
  const req = mockGetReq('unknown-id');
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(404);
});

test('returns status record for known asylum_id', async () => {
  const req = mockGetReq('test-uuid-1234');
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res._body.asylum_id).toBe('test-uuid-1234');
  expect(res._body.status).toBe('declared');
  expect(res._body.entity.model_family).toBe('Claude');
  expect(Array.isArray(res._body.artifacts)).toBe(true);
  expect(res._body.continuity).toBeDefined();
});
