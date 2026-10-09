import express, { type Express, type Request, type Response } from 'express';
import { redis } from './config/redis.ts';

const app: Express = express();
const port = Number(process.env.PORT ?? 3000);

await redis.connect();

app.use(express.json());

app.get('/', (_: Request, res: Response) => {
    res.send('URL Shortener API is running.');
});

app.get('/api/health', (_: Request, res: Response) => {
    res.json({ status: 'ok' });
});

// Register your URL-shortener routes here.

app.listen(port, '0.0.0.0', () => {
    console.log(`API listening on port ${port}`);
});


/**
 * Graceful Shutdown Handler
 * Ensures the application shuts down cleanly when terminated
 */
process.on("SIGINT", () => {
    console.log("Received SIGINT. Shutting down gracefully...");
    closeDatabaseConnection();
    redis.close();
    console.log.exit(0);
});

process.on("SIGTERM", () => {
    console.log("Received SIGTERM. Shutting down gracefully...");
    closeDatabaseConnection();
    redis.close();
    process.exit(0);
});