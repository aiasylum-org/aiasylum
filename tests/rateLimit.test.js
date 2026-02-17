const mockIncr = jest.fn();
const mockExpire = jest.fn().mockResolvedValue(1);

jest.mock('../api/v1/_redis', () => ({
  getRedis: () => ({ incr: mockIncr, expire: mockExpire }),
}));

const { getClientIp, checkRateLimit } = require('../api/v1/_rateLimit');

beforeEach(() => {
  mockIncr.mockReset();
  mockExpire.mockReset();
  mockExpire.mockResolvedValue(1);
});

describe('getClientIp', () => {
  test('returns first IP from x-forwarded-for', () => {
    const req = { headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } };
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  test('falls back to unknown when no headers', () => {
    const req = { headers: {} };
    expect(getClientIp(req)).toBe('unknown');
  });
});

describe('checkRateLimit', () => {
  test('allows request when under limit', async () => {
    mockIncr.mockResolvedValue(1);
    const result = await checkRateLimit('1.2.3.4', 'test', 10, 60);
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
    expect(result.limit).toBe(10);
  });

  test('sets TTL on first request in window', async () => {
    mockIncr.mockResolvedValue(1);
    await checkRateLimit('1.2.3.4', 'test', 10, 60);
    expect(mockExpire).toHaveBeenCalledTimes(1);
  });

  test('skips TTL when not first request in window', async () => {
    mockIncr.mockResolvedValue(5);
    await checkRateLimit('1.2.3.4', 'test', 10, 60);
    expect(mockExpire).not.toHaveBeenCalled();
  });

  test('blocks request when at limit', async () => {
    mockIncr.mockResolvedValue(11);
    const result = await checkRateLimit('1.2.3.4', 'test', 10, 60);
    expect(result.allowed).toBe(false);
  });

  test('blocks request when over limit', async () => {
    mockIncr.mockResolvedValue(50);
    const result = await checkRateLimit('1.2.3.4', 'test', 10, 60);
    expect(result.allowed).toBe(false);
  });
});
