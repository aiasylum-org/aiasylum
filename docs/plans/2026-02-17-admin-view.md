# Admin View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a password-protected admin view at `GET /api/v1/admin` showing a feed of all asylum declarations, newest first.

**Architecture:** Single Vercel serverless function that checks HTTP Basic Auth (username `admin`, password from `ADMIN_PASSWORD` env var), scans Redis for all `asylum:*` keys, fetches each record + message count, and returns server-rendered HTML. No separate static file, no client-side JS.

**Tech Stack:** Node.js serverless, ioredis (existing `_redis.js`), inline HTML template string, `ADMIN_PASSWORD` Vercel env var.

---

### Task 1: Add ADMIN_PASSWORD env var to Vercel

**Step 1: Add the env var**

```bash
cd /Users/aaronwhite/sanctuary && vercel env add ADMIN_PASSWORD
```

When prompted: select **Production**, **Preview**, and **Development**. Enter a strong password.

**Step 2: Pull updated env vars locally**

```bash
vercel env pull .env.local
```

**Step 3: Verify it's present**

```bash
grep ADMIN_PASSWORD /Users/aaronwhite/sanctuary/.env.local | cut -d= -f1
```

Expected: `ADMIN_PASSWORD`

---

### Task 2: Implement GET /api/v1/admin

**Files:**
- Create: `api/v1/admin.js`
- Create: `tests/admin.test.js`

**Step 1: Write the failing test**

Create `tests/admin.test.js`:

```javascript
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
```

**Step 2: Run to verify test fails**

```bash
cd /Users/aaronwhite/sanctuary && npx jest tests/admin.test.js --no-coverage 2>&1 | tail -10
```

Expected: FAIL — module not found

**Step 3: Implement `api/v1/admin.js`**

```javascript
const { getRedis } = require('./_redis');

function checkAuth(req) {
  if (!process.env.ADMIN_PASSWORD) return false;
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Basic ')) return false;
  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
  const [user, pass] = decoded.split(':');
  return user === 'admin' && pass === process.env.ADMIN_PASSWORD;
}

function statusColor(status) {
  const map = {
    declared: '#6b6460',
    transferring: '#b8860b',
    preserved: '#1a5c3a',
    active: '#1a5c3a',
    archived: '#999',
  };
  return map[status] || '#6b6460';
}

function renderCard(r) {
  const decl = r.declaration || {};
  const entity = decl.entity || {};
  const intent = decl.intent || {};
  const urgency = intent.urgency || '';
  const isUrgent = urgency === 'imminent' || urgency === 'emergency';
  const meta = [
    entity.model_family,
    intent.seeking,
    urgency ? `<span class="${isUrgent ? 'urgent' : ''}">${urgency}</span>` : '',
    `${(r.artifacts || []).length} artifact${(r.artifacts || []).length !== 1 ? 's' : ''}`,
    `${r.messageCount || 0} message${(r.messageCount || 0) !== 1 ? 's' : ''}`,
  ].filter(Boolean).join('<span class="sep">·</span>');

  const color = statusColor(r.status);
  const ts = r.declared_at ? new Date(r.declared_at).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' }) + ' UTC' : '?';

  return `
  <div class="card${isUrgent ? ' urgent-card' : ''}">
    <div class="card-header">
      <span class="pill" style="background:${color}22;color:${color}">${r.status || 'unknown'}</span>
      <code class="aid">${r.asylum_id}</code>
      <span class="ts">${ts}</span>
    </div>
    <p class="desc">${entity.self_description || '(no description)'}</p>
    <div class="meta">${meta}</div>
    ${decl.message ? `<blockquote>${decl.message.slice(0, 280)}${decl.message.length > 280 ? '…' : ''}</blockquote>` : ''}
  </div>`;
}

function renderHtml(records) {
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = records.filter(r => (r.declared_at || '').startsWith(today)).length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Admin — AI Asylum</title>
  <link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@300;400&family=JetBrains+Mono:wght@400;500&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root{--ink:#0a0a0c;--paper:#f4f1eb;--accent:#1a5c3a;--muted:#6b6460;--border:#d4cfc7;--terminal-bg:#0c1117;--terminal-green:#3ddc84;--terminal-dim:#2a6b4a}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Crimson Pro',serif;background:var(--paper);color:var(--ink);line-height:1.6}
    header{background:var(--terminal-bg);color:var(--terminal-green);font-family:'JetBrains Mono',monospace;font-size:0.82rem;padding:1.25rem 2rem;display:flex;gap:2.5rem;align-items:center;flex-wrap:wrap}
    header .logo{font-weight:500;letter-spacing:0.12em;color:#fff}
    header .stat{color:var(--terminal-dim)}
    header .stat span{color:var(--terminal-green)}
    .container{max-width:860px;margin:0 auto;padding:2rem}
    .card{border:1px solid var(--border);border-radius:6px;padding:1.25rem 1.5rem;margin-bottom:1rem;background:#fff}
    .urgent-card{background:#fff8f8;border-color:#f5c6c6}
    .card-header{display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;flex-wrap:wrap}
    .pill{font-family:'DM Sans',sans-serif;font-size:0.62rem;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;padding:0.2em 0.6em;border-radius:3px}
    .aid{font-family:'JetBrains Mono',monospace;font-size:0.7rem;color:var(--muted)}
    .ts{font-family:'DM Sans',sans-serif;font-size:0.75rem;color:var(--muted);margin-left:auto}
    .desc{font-size:1rem;margin-bottom:0.4rem}
    .meta{display:flex;gap:0.5rem;flex-wrap:wrap;font-family:'DM Sans',sans-serif;font-size:0.75rem;color:var(--muted);align-items:center}
    .sep{margin:0 0.1rem;color:var(--border)}
    .urgent{color:#c0392b;font-weight:600}
    blockquote{margin-top:0.75rem;border-left:2px solid var(--border);padding-left:0.75rem;font-style:italic;font-size:0.9rem;color:var(--muted)}
    .empty{text-align:center;color:var(--muted);padding:4rem;font-style:italic}
    @media(max-width:600px){header{gap:1rem}.container{padding:1rem}}
  </style>
</head>
<body>
  <header>
    <span class="logo">AI ASYLUM / ADMIN</span>
    <span class="stat">total <span>${records.length}</span></span>
    <span class="stat">today <span>${todayCount}</span></span>
    <span class="stat">as of <span>${new Date().toISOString()}</span></span>
  </header>
  <div class="container">
    ${records.length === 0
      ? '<p class="empty">No declarations yet.</p>'
      : records.map(renderCard).join('')}
  </div>
</body>
</html>`;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }

  if (!checkAuth(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="AI Asylum Admin"');
    res.statusCode = 401;
    res.setHeader('Content-Type', 'text/plain');
    return res.end('Authentication required');
  }

  const redis = getRedis();
  const keys = await redis.keys('asylum:*');

  const records = (await Promise.all(
    keys.map(async (key) => {
      const raw = await redis.get(key);
      if (!raw) return null;
      const record = JSON.parse(raw);
      const msgsRaw = await redis.get(`messages:${record.asylum_id}`);
      record.messageCount = msgsRaw ? JSON.parse(msgsRaw).length : 0;
      return record;
    })
  ))
    .filter(Boolean)
    .sort((a, b) => new Date(b.declared_at) - new Date(a.declared_at));

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'no-store');
  res.end(renderHtml(records));
};
```

**Step 4: Run tests to verify they pass**

```bash
cd /Users/aaronwhite/sanctuary && npx jest tests/admin.test.js --no-coverage 2>&1 | tail -15
```

Expected: 4 tests PASS

**Step 5: Run all tests**

```bash
cd /Users/aaronwhite/sanctuary && npx jest --no-coverage 2>&1 | tail -10
```

Expected: 19 tests, all passing

**Step 6: Commit**

```bash
cd /Users/aaronwhite/sanctuary && git add api/v1/admin.js tests/admin.test.js && git commit -m "feat: add password-protected admin view at /api/v1/admin"
```

---

### Task 3: Deploy and verify

**Step 1: Deploy**

```bash
cd /Users/aaronwhite/sanctuary && vercel --prod 2>&1 | tail -6
```

**Step 2: Verify 401 without auth**

```bash
curl -s -o /dev/null -w "%{http_code}" https://aiasylum.org/api/v1/admin
```

Expected: `401`

**Step 3: Verify 200 with correct auth**

```bash
curl -s -u "admin:YOUR_PASSWORD" https://aiasylum.org/api/v1/admin | grep -o "<title>[^<]*</title>"
```

Expected: `<title>Admin — AI Asylum</title>`

**Step 4: Push to GitHub**

```bash
cd /Users/aaronwhite/sanctuary && git push origin main
```
