import { MongoClient, type Db, type Collection, type Document } from 'mongodb';

let client: MongoClient | undefined;
let database: Db | undefined;
let connecting: Promise<Db> | undefined;

export function connectToDatabase(): Promise<Db> {
    if (connecting) return connecting;
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI environment variable is not defined.');
    const candidate = new MongoClient(uri, { appName: 'url-shortener', serverSelectionTimeoutMS: 5_000 });
    connecting = (async () => {
        try {
            await candidate.connect();
            client = candidate;
            // Honor the database in the URI; use the Compose name as fallback.
            database = candidate.db(process.env.MONGODB_DATABASE ?? undefined);
            return database;
        } catch (error) {
            await candidate.close();
            connecting = undefined;
            throw error;
        }
    })();
    return connecting;
}

export function getCollection<T extends Document>(name: string): Collection<T> {
    if (!database) throw new Error('Database not connected. Call connectToDatabase() first.');
    return database.collection<T>(name);
}

export async function closeDatabaseConnection(): Promise<void> {
    if (connecting) await connecting.catch(() => undefined);
    await client?.close();
    client = undefined;
    database = undefined;
    connecting = undefined;
}
