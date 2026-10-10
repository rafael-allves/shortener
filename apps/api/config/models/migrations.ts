import type { Db } from 'mongodb';

export type Migration = { id: string; up(db: Db): Promise<void> };

export async function runMigrations(db: Db, migrations: readonly Migration[]): Promise<string[]> {
    const ids = migrations.map(migration => migration.id);
    if (new Set(ids).size !== ids.length || ids.some(id => !id)) {
        throw new Error('Migration IDs must be nonempty and unique.');
    }
    const history = db.collection<{ _id: string; appliedAt: Date }>('_migrations');
    const locks = db.collection<{ _id: string }>('_migration_locks');
    // Fail rather than run concurrent schema changes. A crashed runner leaves a
    // lock that must be removed manually after verifying no runner is active.
    await locks.insertOne({ _id: 'schema' });
    const applied: string[] = [];
    try {
        for (const migration of [...migrations].sort((a, b) => a.id.localeCompare(b.id))) {
            if (await history.findOne({ _id: migration.id })) continue;
            await migration.up(db);
            await history.insertOne({ _id: migration.id, appliedAt: new Date() });
            applied.push(migration.id);
        }
        return applied;
    } finally {
        await locks.deleteOne({ _id: 'schema' });
    }
}
