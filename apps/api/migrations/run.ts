import { connectToDatabase, closeDatabaseConnection } from '../config/database.ts';
import { runMigrations } from '../config/models/migrations.ts';
import { migrations } from './index.ts';

try {
    const applied = await runMigrations(await connectToDatabase(), migrations);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
} finally {
    await closeDatabaseConnection();
}
