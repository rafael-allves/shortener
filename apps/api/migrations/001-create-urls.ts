import type { Migration } from '../config/models/migrations.ts';

// Keep applied migrations immutable. Future changes belong in a new migration.
export const createUrls: Migration = {
    id: '001-create-urls',
    async up(db) {
        const options = {
            validator: {
                $jsonSchema: {
                    bsonType: 'object',
                    required: ['shortCode', 'originalUrl', 'createdAt'],
                    properties: {
                        shortCode: { bsonType: 'string', pattern: '^[a-zA-Z0-9]+$' },
                        originalUrl: { bsonType: 'string', pattern: '^https?://' },
                        createdAt: { bsonType: 'date' },
                    },
                },
            },
        };
        if (await db.listCollections({ name: 'urls' }).hasNext()) {
            await db.command({ collMod: 'urls', ...options });
        } else {
            await db.createCollection('urls', options);
        }
        await db.collection('urls').createIndex({ shortCode: 1 }, { unique: true, name: 'urls_shortCode_unique' });
    },
};
