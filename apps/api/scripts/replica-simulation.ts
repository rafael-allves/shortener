import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { MongoClient, MongoServerError } from 'mongodb';
import express from 'express';
import { connectToDatabase, closeDatabaseConnection } from '../config/database.ts';
import { runMigrations } from '../config/models/migrations.ts';
import { migrations } from '../migrations/index.ts';
import { create, get, getAll } from '../features/url/url.controller.ts';

const uri = process.env.MONGODB_URI;
if (!uri?.includes('replicaSet=rsLab')) throw new Error('This simulation requires the isolated rsLab replica set.');
const seed = new MongoClient('mongodb://mongo1:27017/?directConnection=true', { serverSelectionTimeoutMS: 2000 });
try {
    for (let attempt = 0; ; attempt++) {
        try { await seed.connect(); break; }
        catch (error) { if (attempt >= 30) throw error; await delay(1000); }
    }
    try {
        await seed.db('admin').command({ replSetInitiate: {
            _id: 'rsLab', members: [
                { _id: 0, host: 'mongo1:27017' },
                { _id: 1, host: 'mongo2:27017' },
                { _id: 2, host: 'mongo3:27017' },
            ],
        } });
    } catch (error) {
        if (!(error instanceof MongoServerError) || error.code !== 23) throw error;
    }
} finally { await seed.close(); }

const monitor = new MongoClient(uri, { serverSelectionTimeoutMS: 30000 });
await monitor.connect();
process.env.MONGODB_DATABASE = `replica_lab_${randomUUID().replaceAll('-', '')}`;
const db = await connectToDatabase();
const app = express();
app.use(express.json());
app.post('/api/links', create);
app.get('/api/links', getAll);
app.get('/api/links/:shortCode', get);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert.ok(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}/api/links`;

async function benchmark(name: string, requests: number, concurrency: number, request: (index: number) => Promise<Response>) {
    let cursor = 0;
    const latencies: number[] = [];
    const statuses: Record<string, number> = {};
    const started = performance.now();
    await Promise.all(Array.from({ length: concurrency }, async () => {
        for (;;) {
            const index = cursor++;
            if (index >= requests) return;
            const start = performance.now();
            const response = await request(index);
            await response.arrayBuffer();
            statuses[response.status] = (statuses[response.status] ?? 0) + 1;
            latencies.push(performance.now() - start);
            assert.ok(response.status < 400, `${name}: HTTP ${response.status}`);
        }
    }));
    const elapsed = performance.now() - started;
    latencies.sort((a, b) => a - b);
    const percentile = (p: number) => Number(latencies[Math.ceil(p * latencies.length) - 1]!.toFixed(2));
    console.log(JSON.stringify({ name, requests, concurrency, statuses,
        requestsPerSecond: Number((requests * 1000 / elapsed).toFixed(1)), p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99) }));
}
const post = (index: number) => fetch(base, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ originalUrl: `https://example.com/${index}`, shortCode: `lab${index}` }),
    signal: AbortSignal.timeout(30000),
});

try {
    await runMigrations(db, migrations);
    for (const concurrency of [1, 10, 50]) {
        await benchmark(`create-${concurrency}`, 200, concurrency, index => post(concurrency * 1000 + index));
    }
    await benchmark('duplicate-create', 200, 50, () => post(777777));
    assert.equal(await db.collection('urls').countDocuments({ shortCode: 'lab777777' }), 1);
    await benchmark('indexed-lookup', 500, 50, () => fetch(`${base}/lab777777`));
    await benchmark('list-with-count', 200, 20, () => fetch(`${base}?page=1&limit=20`));

    const before = await monitor.db('admin').command({ hello: 1 });
    const direct = new MongoClient(`mongodb://${before.primary}/?directConnection=true`, { serverSelectionTimeoutMS: 5000 });
    await direct.connect();
    const started = performance.now();
    // The benchmark starts alongside step-down, exercising driver election recovery.
    const election = direct.db('admin').command({ replSetStepDown: 30, secondaryCatchUpPeriodSecs: 10 });
    await benchmark('writes-during-failover', 200, 20, index => post(900000 + index));
    await election;
    await direct.close();
    const after = await monitor.db('admin').command({ hello: 1 });
    assert.notEqual(after.primary, before.primary);
    assert.equal(await db.collection('urls').countDocuments(), 801);
    assert.equal((await fetch(`${base}/lab777777`)).status, 200);
    console.log(JSON.stringify({ name: 'failover', previousPrimary: before.primary, newPrimary: after.primary,
        workloadAndElectionMs: Number((performance.now() - started).toFixed(2)), documents: 801 }));
    console.log('PASS: concurrent idempotency, majority writes and primary failover.');
} finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.dropDatabase();
    await closeDatabaseConnection();
    await monitor.close();
}
