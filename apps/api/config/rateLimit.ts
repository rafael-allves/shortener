import { redis } from './redis.ts';
import type { RequestHandler } from 'express';

type RateLimitOptions = {
    limit: number;
    windowMs: number;
    keyPrefix?: string;
};

// Consume quota and establish its expiry in one atomic Redis operation.
// Rejected requests leave both the count and the original expiry unchanged.
const consumeScript = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
if count >= limit then
    return {0, 0, redis.call('PTTL', KEYS[1])}
end
count = redis.call('INCR', KEYS[1])  
if count == 1 then
    redis.call('PEXPIRE', KEYS[1], window)
end
return {1, limit - count, redis.call('PTTL', KEYS[1])}
`;

export class RateLimit {
    private readonly rateLimitOptions: RateLimitOptions;

    constructor(options: RateLimitOptions) {
        if (!Number.isSafeInteger(options.limit) || options.limit <= 0 ||
            !Number.isSafeInteger(options.windowMs) || options.windowMs <= 0) {
            throw new RangeError('limit and windowMs must be positive safe integers.');
        }
        this.rateLimitOptions = options;
    }

    middleware(): RequestHandler {
        return async (req, res, next) => {
            try {
                if (!req.ip) {
                    throw new Error('Cannot rate limit a request without a client IP.');
                }
                const { limit, windowMs, keyPrefix = 'ratelimit:api' } = this.rateLimitOptions;
                const key = `${keyPrefix}:${req.ip}`;
                const [allowed, remaining, ttlMs] = await redis.eval(consumeScript, {
                    keys: [key],
                    arguments: [String(limit), String(windowMs)],
                }) as number[];
                const resetSeconds = Math.ceil(Math.max(0, ttlMs!) / 1000);

                res.setHeader('RateLimit-Limit', limit);
                res.setHeader('RateLimit-Remaining', remaining!);
                res.setHeader('RateLimit-Reset', resetSeconds);
                if (!allowed) {
                    res.setHeader('Retry-After', resetSeconds);
                    res.status(429).json({ error: 'Too many requests.' });
                    return;
                }
                next();
            } catch (error) {
                next(error);
            }
        };
    }
}
