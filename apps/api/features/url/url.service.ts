import { createHash, randomBytes } from 'node:crypto';
import { MongoServerError } from 'mongodb';
import { UrlModel } from './url.model.ts';

export class InvalidUrlError extends Error {}
export class UrlConflictError extends Error {}
export class UrlNotFoundError extends Error {}

export function normalizeUrl(value: unknown): string {
    if (typeof value !== 'string' || value.length > 2048) {
        throw new InvalidUrlError('originalUrl must be an HTTP(S) URL of at most 2048 characters.');
    }
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
            throw new Error('Unsupported URL.');
        }
        const normalized = url.href;
        if (normalized.length > 2048) throw new Error('URL is too long.');
        return normalized;
    } catch {
        throw new InvalidUrlError('originalUrl must be a valid HTTP(S) URL without credentials.');
    }
}

export function validateShortCode(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9]{1,64}$/.test(value)) {
        throw new InvalidUrlError('shortCode must contain 1–64 letters or digits.');
    }
    return value;
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

type CreateOptions = { shortCode?: unknown; idempotencyKey?: unknown };

export async function createUrl(value: unknown, options: CreateOptions = {}, generateCode = () => randomBytes(8).toString('hex')) {
    const originalUrl = normalizeUrl(value);
    const requestedCode = options.shortCode === undefined ? undefined : validateShortCode(options.shortCode);
    const fingerprint = hash(JSON.stringify([originalUrl, requestedCode ?? null]));
    const suppliedKey = options.idempotencyKey;
    if (suppliedKey !== undefined && (typeof suppliedKey !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(suppliedKey))) {
        throw new InvalidUrlError('Idempotency-Key must contain 1–200 visible ASCII characters.');
    }
    const creationKey = suppliedKey === undefined ? `request:${fingerprint}` : `key:${hash(suppliedKey as string)}`;
    const replay = (document: NonNullable<Awaited<ReturnType<typeof UrlModel.findOne>>>) => {
        if (document.creationFingerprint !== fingerprint) {
            throw new UrlConflictError('Idempotency-Key was already used with different input.');
        }
        // Creation responses are immutable even after updates or deletion.
        return { document: { ...document, originalUrl: document.creationUrl! }, created: false };
    };
    const existing = await UrlModel.findOne({ creationKey });
    if (existing) return replay(existing);

    for (let attempt = 0; attempt < (requestedCode ? 1 : 5); attempt++) {
        try {
            const document = await UrlModel.create({
                originalUrl, shortCode: requestedCode ?? generateCode(), createdAt: new Date(),
                creationKey, creationFingerprint: fingerprint, creationUrl: originalUrl,
            });
            return { document, created: true };
        } catch (error) {
            if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
            const winner = await UrlModel.findOne({ creationKey });
            if (winner) return replay(winner);
            if (!error.keyPattern?.shortCode) throw error;
            if (requestedCode) throw new UrlConflictError('The requested shortCode is already reserved.');
        }
    }
    throw new Error('Could not allocate a unique short code after 5 attempts.');
}

export async function getUrl(code: unknown) {
    const shortCode = validateShortCode(code);
    const document = await UrlModel.findOne({ shortCode, deletedAt: { $exists: false } });
    if (!document) throw new UrlNotFoundError('URL not found.');
    return document;
}

// PUT replaces the destination atomically; repeating it has the same effect.
export async function updateUrl(code: unknown, value: unknown) {
    const shortCode = validateShortCode(code);
    const originalUrl = normalizeUrl(value);
    const document = await UrlModel.collection().findOneAndUpdate(
        { shortCode, deletedAt: { $exists: false } },
        { $set: { originalUrl } },
        { returnDocument: 'after' },
    );
    if (!document) throw new UrlNotFoundError('URL not found.');
    return document;
}

// Retain the creation key so a late POST retry cannot recreate a deleted link.
export async function deleteUrl(code: unknown) {
    const shortCode = validateShortCode(code);
    await UrlModel.updateOne(
        { shortCode, deletedAt: { $exists: false } },
        { $set: { deletedAt: new Date() } },
    );
}

function positiveInteger(value: unknown, fallback: number, name: string, maximum: number): number {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
        throw new InvalidUrlError(`${name} must be a positive integer.`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed > maximum) {
        throw new InvalidUrlError(`${name} must be at most ${maximum}.`);
    }
    return parsed;
}

export async function listUrls(query: { page?: unknown; limit?: unknown; shortCut?: unknown }) {
    if (Object.keys(query).some(key => !['page', 'limit', 'shortCut'].includes(key))) {
        throw new InvalidUrlError('Supported query parameters are page, limit and shortCut.');
    }
    const page = positiveInteger(query.page, 1, 'page', 10_000);
    const limit = positiveInteger(query.limit, 20, 'limit', 100);
    const shortCode = query.shortCut === undefined ? undefined : validateShortCode(query.shortCut);
    const filter = { deletedAt: { $exists: false }, ...(shortCode ? { shortCode } : {}) };
    const collection = UrlModel.collection();
    const [documents, total] = await Promise.all([
        collection.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
        collection.countDocuments(filter),
    ]);
    return { documents, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}
