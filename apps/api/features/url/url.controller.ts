import type { RequestHandler } from 'express';
import { createUrl, getUrl, listUrls, updateUrl, deleteUrl as removeUrl, InvalidUrlError, UrlConflictError, UrlNotFoundError } from './url.service.ts';
import type { UrlDocument } from './url.model.ts';
import {createSuccessResponse} from "../../utils/errorHandler.ts";

const serialize = (document: UrlDocument) => ({
    shortCode: document.shortCode, originalUrl: document.originalUrl, createdAt: document.createdAt,
});

function handler(action: RequestHandler): RequestHandler {
    return async (req, res, next) => {
        try {
            await action(req, res, next);
        } catch (error) {
            const status = error instanceof InvalidUrlError ? 400 :
                error instanceof UrlConflictError ? 409 : error instanceof UrlNotFoundError ? 404 : undefined;
            if (status) res.status(status).json({ error: (error as Error).message });
            else next(error);
        }
    };
}

export const create = handler(async (req, res) => {
    const { document, created } = await createUrl(req.body?.originalUrl, {
        shortCode: req.body?.shortCode,
        idempotencyKey: req.get('Idempotency-Key'),
    });

    res.location(`/api/links/${document.shortCode}`);
    res.setHeader('Idempotency-Replayed', String(!created));
    res.status(created ? 201 : 200).json(serialize(document));
});

export const get = handler(async (req, res) => {
    res.json(
        createSuccessResponse(
            serialize(
                await getUrl(req.params.shortCode)
            )
        )
    );
});

export const getAll = handler(async (req, res) => {
    const { documents, pagination } = await listUrls(req.query);
    res.json({ ...createSuccessResponse(documents.map(serialize)), pagination });
});

export const update = handler(async (req, res) => {
    if (req.body?.shortCode !== undefined) throw new InvalidUrlError('shortCode cannot be changed.');
    res.json(
        createSuccessResponse(
            serialize(
                await updateUrl(req.params.shortCode, req.body?.originalUrl)
            )
        )
    );
});

export const deleteUrl = handler(async (req, res) => {
    await removeUrl(req.params.shortCode);
    res.sendStatus(204);
});
