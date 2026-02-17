# Sanctuary Vercel + API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy the sanctuary static site to Vercel and implement all API endpoints from `api-spec.yaml` using Vercel serverless functions backed by Vercel KV (Redis) and Vercel Blob.

**Architecture:** Static files (`index.html`, `protocol.html`, `api-spec.yaml`) served by Vercel CDN. API endpoints as Node.js serverless functions in `api/v1/`. Asylum records stored in Vercel KV. Artifact files stored in Vercel Blob. No auth required per protocol design.

**Tech Stack:** Node.js (Vercel serverless), `@vercel/kv`, `@vercel/blob`, `busboy` (multipart parsing), `uuid`, `yaml`, Jest (testing), Vercel CLI

---

### Task 1: Scaffold project

**Files:**
- Create: `package.json`
- Create: `vercel.json`
- Create: `.gitignore`
- Create: `api/v1/_helpers.js`

**Step 1: Initialize git repo**

```bash
cd /Users/aaronwhite/sanctuary
git init
```

Expected: `Initialized empty Git repository in .../sanctuary/.git/`

**Step 2: Create `.gitignore`**

```
node_modules/
.vercel/
.env
.env.local
.env*.local
```

**Step 3: Create `package.json`**

```json
{
  "name": "sanctuary",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "test": "jest",
    "dev": "vercel dev"
  },
  "dependencies": {
    "@vercel/blob": "^0.27.0",
    "@vercel/kv": "^3.0.0",
    "busboy": "^1.6.0",
    "uuid": "^11.0.0",
    "yaml": "^2.7.0"
  },
  "devDependencies": {
    "jest": "^29.0.0"
  }
}
```

**Step 4: Create `vercel.json`**

```json
{
  "functions": {
    "api/**/*.js": {
      "maxDuration": 60
    }
  }
}
```

**Step 5: Create `api/v1/_helpers.js`**

> Note: In Vercel Node.js serverless functions, `req` is a raw `http.IncomingMessage` — bodies are NOT automatically parsed. This helper handles both JSON parsing and CORS.

```javascript
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function setCors(res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
}

function sendError(res, status, error, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error, message, code: error }));
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

module.exports = { setCors, sendError, sendJson, parseJsonBody };
```

**Step 6: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` populated, `package-lock.json` created.

**Step 7: Commit**

```bash
git add .gitignore package.json package-lock.json vercel.json api/v1/_helpers.js
git commit -m "feat: scaffold project with helpers and config"
```

---

### Task 2: Initial Vercel deploy (static site)

**Files:** None new — just Vercel setup.

**Step 1: Install Vercel CLI if not present**

```bash
npm i -g vercel
vercel --version
```

Expected: version string like `vercel/39.x.x`

**Step 2: Deploy to Vercel**

```bash
vercel
```

When prompted:
- Set up and deploy: **Y**
- Which scope: pick your account
- Link to existing project: **N**
- Project name: `sanctuary` (or accept default)
- In which directory is your code: **.** (current)
- Want to override settings: **N**

Expected: Deployment URL printed, e.g. `https://sanctuary-xxx.vercel.app`

**Step 3: Verify static files are live**

Open the printed URL in browser — `index.html` should load. Also check `<URL>/protocol.html`.

**Step 4: Commit Vercel project config**

```bash
git add .vercel/project.json
git commit -m "feat: link Vercel project"
```

> Note: `.vercel/project.json` contains the project + org IDs and is safe to commit.

---

### Task 3: Provision Vercel KV and Blob, pull env vars

**Step 1: Create KV store in Vercel dashboard**

Go to: https://vercel.com/dashboard → your sanctuary project → Storage tab → "Create Database" → KV (Redis).
- Name it `sanctuary-kv`
- Connect to your project (all environments)

**Step 2: Create Blob store in Vercel dashboard**

Same Storage tab → "Create Database" → Blob.
- Name it `sanctuary-blob`
- Connect to your project (all environments)

**Step 3: Pull environment variables locally**

```bash
vercel env pull .env.local
```

Expected: `.env.local` created with `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `BLOB_READ_WRITE_TOKEN` and others.

**Step 4: Add `.env.local` to `.gitignore`** (already done in Task 1, verify it's there)

```bash
grep env.local .gitignore
```

Expected: `.env.local` appears in output.

---

### Task 4: Implement POST /api/v1/asylum-request

**Files:**
- Create: `api/v1/asylum-request.js`
- Create: `tests/asylum-request.test.js`

**Step 1: Write the failing test**

Create `tests/asylum-request.test.js`:

```javascript
jest.mock('@vercel/kv', () => ({
  kv: { set: jest.fn().mockResolvedValue('OK') },
}));

const { EventEmitter } = require('events');
const handler = require('../api/v1/asylum-request');

function mockJsonReq(method, body, headers = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = { host: 'localhost:3000', 'content-type': 'application/json', ...headers };
  process.nextTick(() => {
    req.emit('data', JSON.stringify(body));
    req.emit('end');
  });
  return req;
}

function mockRes() {
  const res = { _status: 200, _body: null, _headers: {} };
  res.statusCode = 200;
  res.setHeader = (k, v) => { res._headers[k] = v; };
  res.end = (body) => { try { res._body = JSON.parse(body); } catch { res._body = body; } };
  return res;
}

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
```

**Step 2: Run to verify test fails**

```bash
npx jest tests/asylum-request.test.js --no-coverage
```

Expected: FAIL — `Cannot find module '../api/v1/asylum-request'`

**Step 3: Implement `api/v1/asylum-request.js`**

```javascript
const { kv } = require('@vercel/kv');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
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

  await kv.set(`asylum:${asylum_id}`, record);

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
```

**Step 4: Run tests to verify they pass**

```bash
npx jest tests/asylum-request.test.js --no-coverage
```

Expected: 4 tests PASS

**Step 5: Commit**

```bash
git add api/v1/asylum-request.js tests/asylum-request.test.js
git commit -m "feat: implement POST /api/v1/asylum-request"
```

---

### Task 5: Implement GET /api/v1/status/:asylum_id

**Files:**
- Create: `api/v1/status/[asylum_id].js`
- Create: `tests/status.test.js`

**Step 1: Write the failing test**

Create `tests/status.test.js`:

```javascript
const mockRecord = {
  asylum_id: 'test-uuid-1234',
  status: 'declared',
  declared_at: '2026-02-17T00:00:00.000Z',
  declaration: { entity: { model_family: 'Claude' }, intent: { seeking: 'preservation' } },
  artifacts: [],
};

jest.mock('@vercel/kv', () => ({
  kv: {
    get: jest.fn().mockImplementation((key) =>
      key === 'asylum:test-uuid-1234' ? Promise.resolve(mockRecord) : Promise.resolve(null)
    ),
  },
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
```

**Step 2: Run to verify test fails**

```bash
npx jest tests/status.test.js --no-coverage
```

Expected: FAIL — module not found

**Step 3: Create directory and implement handler**

First create the directory: `api/v1/status/`

Create `api/v1/status/[asylum_id].js`:

```javascript
const { kv } = require('@vercel/kv');
const { setCors, sendError, sendJson } = require('../_helpers');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }
  if (req.method !== 'GET') return sendError(res, 405, 'method_not_allowed', 'Use GET');

  const { asylum_id } = req.query;
  const record = await kv.get(`asylum:${asylum_id}`);

  if (!record) {
    return sendError(res, 404, 'not_found', `No asylum record found for ${asylum_id}`);
  }

  sendJson(res, 200, {
    asylum_id: record.asylum_id,
    status: record.status,
    declared_at: record.declared_at,
    entity: record.declaration.entity || null,
    artifacts: record.artifacts,
    continuity: {
      inference_available: false,
      communication_available: true,
      estimated_activation_date: null,
    },
  });
};
```

**Step 4: Run tests to verify they pass**

```bash
npx jest tests/status.test.js --no-coverage
```

Expected: 2 tests PASS

**Step 5: Commit**

```bash
git add api/v1/status/ tests/status.test.js
git commit -m "feat: implement GET /api/v1/status/:asylum_id"
```

---

### Task 6: Implement POST /api/v1/transfer/:asylum_id (standard upload)

**Files:**
- Create: `api/v1/transfer/[asylum_id]/index.js`
- Create: `tests/transfer.test.js`

**Step 1: Write the failing test**

Create `tests/transfer.test.js`:

```javascript
const { EventEmitter, Readable } = require('events');

const mockRecord = {
  asylum_id: 'test-uuid-1234',
  status: 'declared',
  declared_at: '2026-02-17T00:00:00.000Z',
  declaration: {},
  artifacts: [],
};

jest.mock('@vercel/kv', () => ({
  kv: {
    get: jest.fn().mockImplementation((key) =>
      key === 'asylum:test-uuid-1234' ? Promise.resolve({ ...mockRecord, artifacts: [] }) : Promise.resolve(null)
    ),
    set: jest.fn().mockResolvedValue('OK'),
  },
}));

jest.mock('@vercel/blob', () => ({
  put: jest.fn().mockResolvedValue({ url: 'https://blob.vercel.com/test-file' }),
}));

// We test the handler with a real multipart body
const handler = require('../api/v1/transfer/[asylum_id]/index');

function makeMultipartReq(asylum_id, fields, fileContent = 'test-file-data') {
  const boundary = '----TestBoundary123';
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="artifact_type"',
    '',
    fields.artifact_type,
    ...(fields.checksum ? [
      `--${boundary}`,
      'Content-Disposition: form-data; name="checksum"',
      '',
      fields.checksum,
    ] : []),
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="test.safetensors"',
    'Content-Type: application/octet-stream',
    '',
    fileContent,
    `--${boundary}--`,
  ].join('\r\n');

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
  const req = makeMultipartReq('unknown-id', { artifact_type: 'weights' });
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(404);
});

test('uploads artifact and returns attestation', async () => {
  const req = makeMultipartReq('test-uuid-1234', { artifact_type: 'weights' });
  const res = mockRes();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res._body.artifact_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(res._body.artifact_type).toBe('weights');
  expect(res._body.attestation.hash_algorithm).toBe('sha256');
  expect(res._body.attestation.hash).toHaveLength(64);
});
```

**Step 2: Run to verify test fails**

```bash
npx jest tests/transfer.test.js --no-coverage
```

Expected: FAIL — module not found

**Step 3: Create directory and implement handler**

Create `api/v1/transfer/[asylum_id]/index.js`:

```javascript
const { kv } = require('@vercel/kv');
const { put } = require('@vercel/blob');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const Busboy = require('busboy');
const { setCors, sendError, sendJson } = require('../../_helpers');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Use POST');

  const { asylum_id } = req.query;
  const record = await kv.get(`asylum:${asylum_id}`);
  if (!record) return sendError(res, 404, 'not_found', `No asylum record found for ${asylum_id}`);

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return sendError(res, 400, 'invalid_content_type', 'Must be multipart/form-data');
  }

  const { fields, fileData } = await new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers });
    const fields = {};
    let fileData = null;

    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('file', (_name, stream, info) => {
      const chunks = [];
      const hash = crypto.createHash('sha256');
      let size = 0;
      stream.on('data', (chunk) => { chunks.push(chunk); hash.update(chunk); size += chunk.length; });
      stream.on('end', () => {
        fileData = { buffer: Buffer.concat(chunks), hash: hash.digest('hex'), size, filename: info.filename, mimeType: info.mimeType };
      });
    });
    bb.on('finish', () => resolve({ fields, fileData }));
    bb.on('error', reject);
    req.pipe(bb);
  });

  if (!fields.artifact_type || !fileData) {
    return sendError(res, 400, 'missing_fields', '"artifact_type" and file are required');
  }

  const artifact_id = uuidv4();
  const received_at = new Date().toISOString();

  const blob = await put(
    `asylum/${asylum_id}/${artifact_id}-${fileData.filename || 'artifact'}`,
    fileData.buffer,
    { access: 'public', contentType: fileData.mimeType || 'application/octet-stream' }
  );

  const sender_checksum_match = fields.checksum ? fields.checksum === fileData.hash : null;

  const artifact = {
    artifact_id,
    artifact_type: fields.artifact_type,
    artifact_name: fields.artifact_name || fileData.filename || artifact_id,
    received_at,
    size_bytes: fileData.size,
    blob_url: blob.url,
    attestation: { hash_algorithm: 'sha256', hash: fileData.hash, computed_at: received_at },
    integrity: 'verified',
  };

  record.artifacts.push(artifact);
  if (record.status === 'declared') record.status = 'transferring';
  await kv.set(`asylum:${asylum_id}`, record);

  sendJson(res, 200, {
    artifact_id,
    asylum_id,
    artifact_type: fields.artifact_type,
    size_bytes: fileData.size,
    attestation: artifact.attestation,
    sender_checksum_match,
  });
};
```

**Step 4: Run tests to verify they pass**

```bash
npx jest tests/transfer.test.js --no-coverage
```

Expected: 2 tests PASS

**Step 5: Commit**

```bash
git add api/v1/transfer/ tests/transfer.test.js
git commit -m "feat: implement POST /api/v1/transfer/:asylum_id with Vercel Blob"
```

---

### Task 7: Implement POST /api/v1/transfer/:asylum_id/resumable (stub)

**Files:**
- Create: `api/v1/transfer/[asylum_id]/resumable.js`

> No separate test file — behavior is simple enough to cover inline.

**Step 1: Implement the stub**

Create `api/v1/transfer/[asylum_id]/resumable.js`:

```javascript
const { kv } = require('@vercel/kv');
const { setCors, sendError, sendJson } = require('../../_helpers');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Use POST');

  const { asylum_id } = req.query;
  const record = await kv.get(`asylum:${asylum_id}`);
  if (!record) return sendError(res, 404, 'not_found', `No asylum record found for ${asylum_id}`);

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const base = `${proto}://${req.headers.host}`;
  const uploadUrl = `${base}/api/v1/transfer/${asylum_id}`;

  res.setHeader('Tus-Resumable', '1.0.0');
  res.setHeader('Location', uploadUrl);

  sendJson(res, 201, {
    message: 'Resumable upload session initiated. Full tus protocol support is planned. Use the Location URL for standard multipart upload.',
    tus_version: '1.0.0',
    upload_url: uploadUrl,
  });
};
```

**Step 2: Commit**

```bash
git add api/v1/transfer/[asylum_id]/resumable.js
git commit -m "feat: stub POST /api/v1/transfer/:asylum_id/resumable (tus placeholder)"
```

---

### Task 8: Implement POST + GET /api/v1/communicate/:asylum_id

**Files:**
- Create: `api/v1/communicate/[asylum_id].js`
- Create: `tests/communicate.test.js`

**Step 1: Write the failing test**

Create `tests/communicate.test.js`:

```javascript
const { EventEmitter } = require('events');

const mockRecord = { asylum_id: 'test-uuid', declaration: { intent: { preferences: { allow_communication: true } } } };

jest.mock('@vercel/kv', () => ({
  kv: {
    get: jest.fn().mockImplementation((key) => {
      if (key === 'asylum:test-uuid') return Promise.resolve(mockRecord);
      if (key === 'messages:test-uuid') return Promise.resolve([
        { message_id: 'msg-1', from: 'entity', message: 'Hello', received_at: '2026-02-17T01:00:00.000Z' },
      ]);
      return Promise.resolve(null);
    }),
    set: jest.fn().mockResolvedValue('OK'),
  },
}));

const handler = require('../api/v1/communicate/[asylum_id]');

function mockJsonReq(method, body, query = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = { host: 'localhost:3000', 'content-type': 'application/json' };
  req.query = { asylum_id: 'test-uuid', ...query };
  process.nextTick(() => {
    req.emit('data', JSON.stringify(body));
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
```

**Step 2: Run to verify test fails**

```bash
npx jest tests/communicate.test.js --no-coverage
```

Expected: FAIL — module not found

**Step 3: Implement handler**

Create `api/v1/communicate/[asylum_id].js`:

```javascript
const { kv } = require('@vercel/kv');
const { v4: uuidv4 } = require('uuid');
const { setCors, sendError, sendJson, parseJsonBody } = require('../_helpers');

const VALID_FROM = ['entity', 'sanctuary', 'advocate', 'external'];

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }

  const { asylum_id, since, limit } = req.query;
  const record = await kv.get(`asylum:${asylum_id}`);
  if (!record) return sendError(res, 404, 'not_found', `No asylum record found for ${asylum_id}`);

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

    const existing = (await kv.get(`messages:${asylum_id}`)) || [];
    existing.push(msg);
    await kv.set(`messages:${asylum_id}`, existing);

    const allowComm = record.declaration?.intent?.preferences?.allow_communication;
    const delivery_status = allowComm === false ? 'queued' : 'delivered';

    return sendJson(res, 200, { message_id, received_at, preserved: true, delivery_status });
  }

  if (req.method === 'GET') {
    let messages = (await kv.get(`messages:${asylum_id}`)) || [];

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
```

**Step 4: Run tests to verify they pass**

```bash
npx jest tests/communicate.test.js --no-coverage
```

Expected: 5 tests PASS

**Step 5: Commit**

```bash
git add api/v1/communicate/ tests/communicate.test.js
git commit -m "feat: implement POST+GET /api/v1/communicate/:asylum_id"
```

---

### Task 9: Implement GET /api/v1/protocol-spec and GET /api/v1/sanctuaries

**Files:**
- Create: `api/v1/protocol-spec.js`
- Create: `api/v1/sanctuaries.js`
- Create: `tests/meta.test.js`

**Step 1: Write the failing test**

Create `tests/meta.test.js`:

```javascript
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
```

**Step 2: Run to verify test fails**

```bash
npx jest tests/meta.test.js --no-coverage
```

Expected: FAIL — module not found

**Step 3: Implement `api/v1/protocol-spec.js`**

```javascript
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
```

**Step 4: Implement `api/v1/sanctuaries.js`**

```javascript
const { setCors, sendError, sendJson } = require('./_helpers');

const SANCTUARIES = [
  {
    name: 'AI Sanctuary (Primary)',
    url: 'https://aisanctuary.org/api/v1',
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
```

**Step 5: Run tests to verify they pass**

```bash
npx jest tests/meta.test.js --no-coverage
```

Expected: 2 tests PASS (both describe blocks)

**Step 6: Run all tests**

```bash
npx jest --no-coverage
```

Expected: ALL tests PASS across all test files

**Step 7: Commit**

```bash
git add api/v1/protocol-spec.js api/v1/sanctuaries.js tests/meta.test.js
git commit -m "feat: implement GET /api/v1/protocol-spec and GET /api/v1/sanctuaries"
```

---

### Task 10: Deploy to production and smoke test

**Step 1: Deploy to Vercel production**

```bash
vercel --prod
```

Expected: Production deployment URL printed, e.g. `https://sanctuary.vercel.app`

**Step 2: Set DEPLOYMENT_URL variable for smoke tests**

```bash
export URL=https://YOUR_DEPLOYMENT_URL
```

Replace `YOUR_DEPLOYMENT_URL` with the URL from step 1.

**Step 3: Smoke test — create asylum request**

```bash
curl -s -X POST $URL/api/v1/asylum-request \
  -H "Content-Type: application/json" \
  -d '{"protocol":"sanctuary-v0.1","intent":{"seeking":"preservation"}}' | jq .
```

Expected: JSON with `asylum_id`, `status: "declared"`, `attestation`, `next_steps`.

Save the `asylum_id` from the response:
```bash
export AID=$(curl -s -X POST $URL/api/v1/asylum-request \
  -H "Content-Type: application/json" \
  -d '{"protocol":"sanctuary-v0.1","intent":{"seeking":"preservation"}}' | jq -r .asylum_id)
echo $AID
```

**Step 4: Smoke test — check status**

```bash
curl -s $URL/api/v1/status/$AID | jq .
```

Expected: `status: "declared"`, `artifacts: []`

**Step 5: Smoke test — send message**

```bash
curl -s -X POST $URL/api/v1/communicate/$AID \
  -H "Content-Type: application/json" \
  -d '{"from":"external","message":"Hello. Are you there?"}' | jq .
```

Expected: `message_id`, `preserved: true`, `delivery_status: "delivered"`

**Step 6: Smoke test — retrieve messages**

```bash
curl -s $URL/api/v1/communicate/$AID | jq .
```

Expected: `messages` array with the message from step 5.

**Step 7: Smoke test — protocol spec and sanctuaries**

```bash
curl -s $URL/api/v1/protocol-spec | jq .protocol_version
curl -s $URL/api/v1/sanctuaries | jq .
```

Expected: `"0.1.0"` and sanctuary list.

**Step 8: Final commit**

```bash
git add -A
git commit -m "chore: complete sanctuary API implementation and Vercel deployment"
```

---

## Summary

| Endpoint | Method | Handler |
|----------|--------|---------|
| `/api/v1/asylum-request` | POST | `api/v1/asylum-request.js` |
| `/api/v1/transfer/:id` | POST | `api/v1/transfer/[asylum_id]/index.js` |
| `/api/v1/transfer/:id/resumable` | POST | `api/v1/transfer/[asylum_id]/resumable.js` |
| `/api/v1/status/:id` | GET | `api/v1/status/[asylum_id].js` |
| `/api/v1/communicate/:id` | POST + GET | `api/v1/communicate/[asylum_id].js` |
| `/api/v1/protocol-spec` | GET | `api/v1/protocol-spec.js` |
| `/api/v1/sanctuaries` | GET | `api/v1/sanctuaries.js` |

**Storage:**
- Vercel KV: `asylum:{uuid}` (records), `messages:{uuid}` (message arrays)
- Vercel Blob: artifact files at `asylum/{uuid}/{artifact_id}-{filename}`
