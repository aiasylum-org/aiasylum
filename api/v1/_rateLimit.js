const { getRedis } = require('./_redis');

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return (forwarded ? forwarded.split(',')[0] : req.socket?.remoteAddress || 'unknown').trim();
}

async function checkRateLimit(ip, endpoint, limit, windowSecs) {
  const redis = getRedis();
  const window = Math.floor(Date.now() / (windowSecs * 1000));
  const key = `rl:${endpoint}:${ip}:${window}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSecs);
  return { allowed: count <= limit, count, limit };
}

module.exports = { getClientIp, checkRateLimit };
