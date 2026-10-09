import { createClient } from 'redis';

export const redis = createClient({
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    socket: {
        connectTimeout: 5_000,
    },
});

redis.on('error', (error: Error) => {
    console.error('Redis client error:', error.message);
});