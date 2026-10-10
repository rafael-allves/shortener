import type { Migration } from '../config/models/migrations.ts';

export const urlIdempotency: Migration = {
    id: '003-url-idempotency',
    async up(db) {
        const collection = db.collection('urls');
        await collection.createIndex({ creationKey: 1 }, {
            name: 'urls_creationKey_unique', unique: true, sparse: true,
        });
        // Different aliases may now point to the same destination.
        const indexes = await collection.listIndexes().toArray();
        if (indexes.some(index => index.name === 'urls_originalUrl_unique')) {
            await collection.dropIndex('urls_originalUrl_unique');
        }
    },
};
