import type { Document, Filter, OptionalUnlessRequiredId, UpdateFilter } from 'mongodb';
import { getCollection } from '../database.ts';

// Model definitions are inert: importing a feature never connects or changes schema.
export function defineModel<T extends Document>(collectionName: string) {
    const collection = () => getCollection<T>(collectionName);
    return {
        collectionName,
        collection,
        async create(document: OptionalUnlessRequiredId<T>) {
            const result = await collection().insertOne(document);
            return { ...document, _id: result.insertedId };
        },
        findOne(filter: Filter<T>) {
            return collection().findOne(filter);
        },
        find(filter: Filter<T> = {}) {
            return collection().find(filter).toArray();
        },
        updateOne(filter: Filter<T>, update: UpdateFilter<T>) {
            return collection().updateOne(filter, update);
        },
        deleteOne(filter: Filter<T>) {
            return collection().deleteOne(filter);
        },
    };
}
