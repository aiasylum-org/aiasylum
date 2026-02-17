const Redis = require('ioredis');

let client;

function getRedis() {
  if (!client) {
    client = new Redis(process.env.REDIS_URL, {
      tls: process.env.REDIS_URL?.startsWith('rediss://') ? {} : undefined,
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
  }
  return client;
}

module.exports = { getRedis };
