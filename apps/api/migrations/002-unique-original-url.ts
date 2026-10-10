import type { Migration } from '../config/models/migrations.ts';

export const uniqueOriginalUrl: Migration = {
    id: '002-unique-original-url',
    async up(db) {
        // Existing duplicates deliberately fail the migration rather than deleting links.
        await db.collection('urls').createIndex(
            { originalUrl: 1 },
            { unique: true, name: 'urls_originalUrl_unique' },
        );
    },
};
