import { createUrls } from './001-create-urls.ts';
import { uniqueOriginalUrl } from './002-unique-original-url.ts';
import { urlIdempotency } from './003-url-idempotency.ts';
import { urlListIndex } from './004-url-list-index.ts';
export const migrations = [createUrls, uniqueOriginalUrl, urlIdempotency, urlListIndex];
