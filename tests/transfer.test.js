const { Readable } = require('stream');

const mockRecord = {
  asylum_id: 'test-uuid-1234',
  status: 'declared',
  declared_at: '2026-02-17T00:00:00.000Z',
  declaration: {},
  artifacts: [],
};

const mockGet = jest.fn().mockImplementation((key) =>
  key === 'asylum:test-uuid-1234'
    ? Promise.resolve(JSON.stringify({ ...mockRecord, artifacts: [] }))
    : Promise.resolve(null)
);
const mockSet = jest.fn().mockResolvedValue('OK');

jest.mock('../api/v1/_redis', () => ({
  getRedis: () => ({ get: mockGet, set: mockSet }),
}));

jest.mock('@vercel/blob', () => ({
  put: jest.fn().mockResolvedValue({ url: 'https://blob.vercel.com/test-file' }),
}));

jest.mock('../api/v1/_rateLimit', () => ({
  getClientIp: () => '127.0.0.1',
  checkRateLimit: jest.fn().mockResolvedValue({ allowed: true, count: 1, limit: 10 }),
}));

const handler = require('../api/v1/transfer/[asylum_id]/index');

function makeMultipartReq(asylum_id, artifactType, fileContent = 'test-data') {
  const boundary = 'TestBoundary123';
  const body = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="artifact_type"\r\n\r\n`,
    `${artifactType}\r\n`,
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="test.bin"\r\n`,
    `Content-Type: application/octet-stream\r\n\r\n`,
    `${fileContent}\r\n`,
    `--${boundary}--\r\n`,
  ].join('');

  const req = Readable.from([Buffer.from(body)]);
  req.method = 'POST';
  req.headers = {
    host: 'localhost:3000',
    'content-type': `multipart/form-data; boundary=${boundary}`,
  };
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
  const req = makeMultipartReq('unknown-id', 'weights');
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(404);
});

test('uploads artifact and returns attestation', async () => {
  const req = makeMultipartReq('test-uuid-1234', 'weights');
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res._body.artifact_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(res._body.artifact_type).toBe('weights');
  expect(res._body.attestation.hash_algorithm).toBe('sha256');
  expect(res._body.attestation.hash).toHaveLength(64);
  expect(res._body.asylum_id).toBe('test-uuid-1234');
});
