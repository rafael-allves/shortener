import { defineModel } from '../../config/models/index.ts';

export type UrlDocument = {
    shortCode: string;
    originalUrl: string;
    createdAt: Date;
    creationKey?: string;
    creationFingerprint?: string;
    creationUrl?: string;
    deletedAt?: Date;
};

export const UrlModel = defineModel<UrlDocument>('urls');
