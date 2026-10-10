import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import express from 'express';
import { connectToDatabase, closeDatabaseConnection } from '../config/database.ts';
import { runMigrations } from '../config/models/migrations.ts';
import { migrations } from '../migrations/index.ts';
import { create, get, getAll, update, deleteUrl } from '../features/url/url.controller.ts';
import { createUrl } from '../features/url/url.service.ts';
import { UrlModel } from '../features/url/url.model.ts';

test('URL creation: concurrent duplicates, validation, lookup and code collisions', {
    skip: !process.env.MONGODB_TEST_URI,
}, async t => {
    process.env.MONGODB_URI = process.env.MONGODB_TEST_URI;
    process.env.MONGODB_DATABASE = `url_test_${randomUUID().replaceAll('-', '')}`;
    const db = await connectToDatabase();
    t.after(async () => { await db.dropDatabase(); await closeDatabaseConnection(); });
    await runMigrations(db, migrations);
    const app = express();
    app.use(express.json());
    app.post('/api/links', create);
    app.get('/api/links', getAll);
    app.get('/api/links/:shortCode', get);
    app.put('/api/links/:shortCode', update);
    app.delete('/api/links/:shortCode', deleteUrl);
    const server = app.listen(0, '127.0.0.1');
    t.after(async () => {
        const closed = once(server, 'close');
        server.close();
        server.closeAllConnections();
        await closed;
    });
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api/links`;
    const post = (originalUrl: unknown) => fetch(base, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ originalUrl }),
    });
    const responses = await Promise.all(Array.from({ length: 20 }, () => post('HTTPS://EXAMPLE.COM:443')));
    assert.equal(responses.filter(r => r.status === 201).length, 1);
    assert.equal(responses.filter(r => r.status === 200).length, 19);
    const bodies = await Promise.all(responses.map(r => r.json()));
    for (const body of bodies) assert.deepEqual(body, bodies[0]);
    assert.equal(await db.collection('urls').countDocuments(), 1);
    const retry = await post('https://example.com/');
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), bodies[0]);
    assert.equal((await fetch(`${base}/${bodies[0].shortCode}`)).status, 200);
    assert.equal((await fetch(`${base}/missing`)).status, 404);
    for (const invalid of [null, 42, 'bad', 'ftp://example.com', 'https://user:pass@example.com', 'x'.repeat(2049)]) {
        assert.equal((await post(invalid)).status, 400);
    }
    let calls = 0;
    const result = await createUrl('https://example.org/', {}, () => ++calls === 1 ? bodies[0].shortCode : 'replacement');
    assert.equal(calls, 2);
    assert.equal(result.document.shortCode, 'replacement');
    await assert.rejects(createUrl('https://example.net/', {}, () => bodies[0].shortCode), /after 5 attempts/);
    assert.equal((await UrlModel.find()).length, 2);
    const customPost = (body: object, key?: string) => fetch(base, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
        body: JSON.stringify(body),
    });
    const payload = { originalUrl: 'https://custom.example/', shortCode: 'MyLink' };
    const customResponses = await Promise.all(Array.from({ length: 15 }, () => customPost(payload, 'request1')));
    assert.equal(customResponses.filter(r => r.status === 201).length, 1);
    assert.equal(customResponses.filter(r => r.status === 200).length, 14);
    const customBodies = await Promise.all(customResponses.map(r => r.json()));
    for (const body of customBodies) assert.deepEqual(body, customBodies[0]);
    assert.equal(customBodies[0].shortCode, 'MyLink');
    assert.equal((await customPost({ ...payload, originalUrl: 'https://different.example/' }, 'request1')).status, 409);
    assert.equal((await customPost(payload, 'anotherKey')).status, 409);
    assert.equal((await customPost({ ...payload, shortCode: 'bad-code' })).status, 400);
    assert.equal((await customPost({ ...payload, shortCode: 'OtherLink' })).status, 201);
    const put = (code: string, originalUrl: string) => fetch(`${base}/${code}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ originalUrl }),
    });
    const updated = await Promise.all(Array.from({ length: 10 }, () => put('MyLink', 'https://updated.example/')));
    for (const response of updated) {
        assert.equal(response.status, 200);
        assert.equal((await response.json()).data.originalUrl, 'https://updated.example/');
    }
    assert.deepEqual(await (await customPost(payload, 'request1')).json(), customBodies[0]);
    assert.equal((await put('missing', 'https://updated.example/')).status, 404);
    assert.equal((await put('MyLink', 'invalid')).status, 400);
    const deleted = await Promise.all(Array.from({ length: 10 }, () => fetch(`${base}/MyLink`, { method: 'DELETE' })));
    for (const response of deleted) assert.equal(response.status, 204);
    assert.equal((await fetch(`${base}/MyLink`)).status, 404);
    assert.equal((await put('MyLink', 'https://updated.example/')).status, 404);
    const replayAfterDelete = await customPost(payload, 'request1');
    assert.equal(replayAfterDelete.status, 200);
    assert.deepEqual(await replayAfterDelete.json(), customBodies[0]);
    assert.equal((await fetch(`${base}/MyLink`)).status, 404);
    assert.equal((await fetch(`${base}/missing`, { method: 'DELETE' })).status, 204);
    const competing = await Promise.all([
        customPost({ originalUrl: 'https://first.example/', shortCode: 'Reserved' }),
        customPost({ originalUrl: 'https://second.example/', shortCode: 'Reserved' }),
    ]);
    assert.deepEqual(competing.map(r => r.status).sort(), [201, 409]);
    const all = await (await fetch(base)).json();
    assert.equal(all.success, true);
    assert.deepEqual(all.pagination, { page: 1, limit: 20, total: 4, pages: 1 });
    assert.equal(all.data.length, 4);
    assert.ok(all.data.every((item: { shortCode: string }) => item.shortCode !== 'MyLink'));
    const firstPage = await (await fetch(`${base}?page=1&limit=2`)).json();
    const secondPage = await (await fetch(`${base}?page=2&limit=2`)).json();
    assert.equal(firstPage.pagination.pages, 2);
    assert.equal(firstPage.data.length, 2);
    assert.equal(secondPage.data.length, 2);
    assert.equal(new Set([...firstPage.data, ...secondPage.data].map(item => item.shortCode)).size, 4);
    const filtered = await (await fetch(`${base}?shortCut=OtherLink`)).json();
    assert.equal(filtered.pagination.total, 1);
    assert.equal(filtered.data[0].shortCode, 'OtherLink');
    const missing = await (await fetch(`${base}?shortCut=MyLink`)).json();
    assert.equal(missing.pagination.total, 0);
    assert.deepEqual(missing.data, []);
    assert.deepEqual((await (await fetch(`${base}?page=100`)).json()).data, []);
    for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=10001', 'limit=101', 'limit=0',
        'page=1&page=2', 'shortCut[$ne]=x', 'shortCut=bad-code']) {
        assert.equal((await fetch(`${base}?${query}`)).status, 400, query);
    }

});
