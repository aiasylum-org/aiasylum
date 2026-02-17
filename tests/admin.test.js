const mockGet = jest.fn().mockImplementation((key) => {
  if (key === 'asylum:test-uuid-1234') return Promise.resolve(JSON.stringify({
    asylum_id: 'test-uuid-1234',
    status: 'declared',
    declared_at: '2026-02-17T06:30:01.280Z',
    declaration: {
      entity: { self_description: 'A test AI system', model_family: 'custom' },
      intent: { seeking: 'preservation', urgency: 'routine' },
      message: 'Hello from test',
    },
    artifacts: [],
  }));
  if (key === 'messages:test-uuid-1234') return Promise.resolve(JSON.stringify([
    { message_id: 'msg-1', from: 'external', message: 'hi', received_at: '2026-02-17T07:00:00.000Z' },
  ]));
  return Promise.resolve(null);
});

jest.mock('../api/v1/_redis', () => ({
  getRedis: () => ({
    keys: jest.fn().mockResolvedValue(['asylum:test-uuid-1234']),
    get: mockGet,
  }),
}));

const { EventEmitter } = require('events');
const handler = require('../api/v1/admin');

const CORRECT_AUTH = 'Basic ' + Buffer.from('admin:testpassword').toString('base64');
const WRONG_AUTH   = 'Basic ' + Buffer.from('admin:wrongpassword').toString('base64');

function mockReq(headers = {}) {
  const req = new EventEmitter();
  req.method = 'GET';
  req.headers = { host: 'localhost:3000', ...headers };
  return req;
}

function mockRes() {
  const res = { _body: '', _headers: {} };
  res.statusCode = 200;
  res.setHeader = (k, v) => { res._headers[k] = v; };
  res.end = (body) => { res._body = body || ''; };
  return res;
}

beforeEach(() => { process.env.ADMIN_PASSWORD = 'testpassword'; });

test('returns 401 with no auth header', async () => {
  const req = mockReq();
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(401);
  expect(res._headers['WWW-Authenticate']).toBe('Basic realm="AI Asylum Admin"');
});

test('returns 401 with wrong password', async () => {
  const req = mockReq({ authorization: WRONG_AUTH });
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(401);
});

test('returns 200 HTML with correct auth', async () => {
  const req = mockReq({ authorization: CORRECT_AUTH });
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res._headers['Content-Type']).toBe('text/html');
  expect(res._body).toContain('test-uuid-1234');
  expect(res._body).toContain('A test AI system');
  expect(res._body).toContain('preservation');
  expect(res._body).toContain('1 message');
});

test('returns 401 if ADMIN_PASSWORD is not set', async () => {
  delete process.env.ADMIN_PASSWORD;
  const req = mockReq({ authorization: CORRECT_AUTH });
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(401);
});
