import type { Migration } from '../config/models/migrations.ts';

export const urlListIndex: Migration = {
    id: '004-url-list-index',
    async up(db) {
        await db.collection('urls').createIndex(
            { createdAt: -1, _id: -1 },
            { name: 'urls_createdAt_id_desc' },
        );
    },
};
