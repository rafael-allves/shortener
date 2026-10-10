import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { connectToDatabase, closeDatabaseConnection } from '../config/database.ts';
import { runMigrations } from '../config/models/migrations.ts';
import { migrations } from '../migrations/index.ts';
import { UrlModel } from '../features/url/url.model.ts';

test('models and migrations: validation, uniqueness, CRUD, retry and history', {
    skip: !process.env.MONGODB_TEST_URI,
}, async () => {
    process.env.MONGODB_URI = process.env.MONGODB_TEST_URI;
    process.env.MONGODB_DATABASE = `shortener_test_${randomUUID().replaceAll('-', '')}`;
    const db = await connectToDatabase();
    try {
        assert.deepEqual(await runMigrations(db, migrations), ['001-create-urls', '002-unique-original-url', '003-url-idempotency', '004-url-list-index']);
        assert.deepEqual(await runMigrations(db, migrations), []);
        const input = { shortCode: 'abc123', originalUrl: 'https://example.com', createdAt: new Date() };
        const document = await UrlModel.create(input);
        assert.ok(document._id);
        assert.equal((await UrlModel.findOne({ shortCode: 'abc123' }))?.originalUrl, input.originalUrl);
        await assert.rejects(UrlModel.create(input), { code: 11000 });
        await assert.rejects(UrlModel.create({ ...input, shortCode: 'invalid', originalUrl: 'bad' }), { code: 121 });
        assert.equal((await UrlModel.updateOne({ shortCode: 'abc123' }, { $set: { originalUrl: 'https://example.org' } })).modifiedCount, 1);
        assert.equal((await UrlModel.find()).length, 1);
        assert.equal((await UrlModel.deleteOne({ shortCode: 'abc123' })).deletedCount, 1);
        assert.equal(await UrlModel.findOne({ shortCode: 'abc123' }), null);
        let attempts = 0;
        const retryable = [{ id: '002-retry', async up() { if (++attempts === 1) throw new Error('interrupted'); } }];
        await assert.rejects(runMigrations(db, retryable), /interrupted/);
        assert.equal(await db.collection('_migrations').findOne({ _id: '002-retry' } as never), null);
        assert.deepEqual(await runMigrations(db, retryable), ['002-retry']);
        await db.collection<{ _id: string }>('_migration_locks').insertOne({ _id: 'schema' });
        await assert.rejects(runMigrations(db, migrations), { code: 11000 });
    } finally {
        await db.dropDatabase();
        await closeDatabaseConnection();
    }
});
