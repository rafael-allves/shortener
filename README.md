# Monorepo MERN com TypeScript

Skeleton mínimo com API Express e frontend React em TypeScript, npm workspaces e Docker. As funcionalidades do encurtador ficam para você implementar.

## Estrutura

- `package.json` na raiz com npm workspaces (`apps/*`) e `package-lock.json`.
- `apps/api/package.json`: workspace `@shortener/api`, script `build` que compila TypeScript; entrada gerada em `apps/api/dist/server.js`. O servidor escuta em `0.0.0.0:3000` ; a futura conexão com MongoDB deve usar `MONGODB_URI`.
- `apps/web/package.json`: workspace `@shortener/web`, React com TypeScript e Vite; script `build` que gera o frontend em `apps/web/dist`.
- Configurações TypeScript e demais arquivos de build dentro dos respectivos workspaces.

Os Dockerfiles usam o contexto da raiz do monorepo. Se alterar os nomes dos workspaces ou o caminho de saída do TypeScript, ajuste os Dockerfiles.

## Comandos

Para iniciar apenas MongoDB, sem código da aplicação:

```bash
docker compose up -d mongo
```

Para executar o skeleton com Docker:

```bash
cp .env.example .env
docker compose up --build -d
```

Frontend: http://localhost:8080. API: http://localhost:3000 (porta publicada apenas em loopback). Nginx encaminha `/api/` e `/s/` para a API. MongoDB fica acessível apenas na rede Docker. Ajuste as rotas de proxy em `apps/web/nginx.conf` conforme as rotas que implementar. Pare a API do Docker antes de executar a API localmente na mesma porta.

`WEB_PORT` altera a porta do frontend. Ajuste `PUBLIC_BASE_URL` para a mesma origem; essa variável fica disponível para as futuras rotas de encurtamento. A conexão interna do MongoDB é definida no Compose.

```bash
docker compose config --quiet # Validar configuração
docker compose logs -f       # Ver logs
docker compose down          # Parar sem apagar os dados
```

O volume `mongo_data` preserva os dados. O health check da API verifica apenas se a porta TCP está aberta; adapte para um endpoint de readiness quando implementar a verificação de conexão com o banco.

## Desenvolvimento local

Requer Node.js 24+.

```bash
npm ci
npm run dev
```

Frontend em http://localhost:5173; API em http://localhost:3000/api/health. O Vite faz proxy de `/api` e `/s` para a API. O health check indica apenas que o servidor está ativo; a conexão com MongoDB ainda não está implementada.

```bash
npm run typecheck
npm run build
```

Na API, `server.ts` é a entrada; `routes/`, `controllers/`, `services/`, `models/` e `config/` são diretórios vazios para sua implementação. No frontend, `src/App.tsx` é o ponto de partida; `components/`, `services/` e `hooks/` são diretórios vazios. O skeleton usa o [suporte TypeScript do React](https://react.dev/learn/typescript) e o [Vite](https://vite.dev/guide/).

## Conceitos de system design

Os itens abaixo são exercícios planejados; Redis e replica sets ainda não estão configurados no Compose.

| Conceito | O que praticar | Infraestrutura Docker |
| --- | --- | --- |
| **Hashing** | Gerar um hash da URL, codificar parte do resultado como código curto e tratar colisões com um índice único no banco. Base62 é codificação, não hashing. | Nenhuma adicional; implementação futura em TypeScript |
| **Caching** | Armazenar `shortCode → originalUrl` no Redis. Em um cache miss, consultar o MongoDB e preencher o cache com TTL. | Redis |
| **Database scaling** | Começar com índices e depois estudar replicação, failover e sharding. | Inicialmente, um replica set do MongoDB |
| **Rate limiting** | Compartilhar contadores de requisições entre instâncias da API usando operações atômicas ou scripts Lua no Redis. | Redis |

Um replica set permite estudar redundância e failover; sharding distribui dados e cargas de escrita. São exercícios distintos. Consulte a [documentação de escalabilidade do MongoDB](https://www.mongodb.com/docs/v8.0/core/sharding-scaling-strategies/).

Redis oferece suporte a caching e rate limiting distribuído, mas cada uso exige decisões próprias sobre eviction e comportamento em falhas. Consulte os [padrões de uso do Redis](https://redis.io/docs/latest/develop/use-cases/).

## Exercício: testes de rate limiting

Execute `npm test` para rodar `apps/api/test/rateLimit.test.ts` com o test runner nativo do Node.js 24. Os testes estão intencionalmente vermelhos: implemente `RateLimit` em `apps/api/config/rateLimit.ts` para fazê-los passar.

Contrato: `new RateLimit({ limit, windowMs, now })` e `consume(key)`, que retorna `{ allowed, remaining, retryAfterMs }` (diretamente ou via Promise). Cada cliente tem uma janela fixa iniciada em sua primeira requisição. Ao atingir o limite, novas requisições são recusadas até a expiração; requisições aceitas ou recusadas não prolongam a janela. O relógio `now` é injetado para testar o tempo sem sleeps.

Os testes cobrem limites, isolamento entre clientes, expiração, retry, concorrência e opções inválidas. Comece em memória; depois explore Redis para compartilhar o estado entre instâncias. Os testes unitários não comprovam atomicidade entre processos ou servidores Redis.

A pasta `test/` fica fora do build/typecheck da aplicação enquanto você desenvolve o contrato. O runner executa os testes TypeScript sem checagem estática de tipos.

### Testes HTTP do rate limiter

`apps/api/test/rateLimit.http.test.ts` complementa os testes unitários com requisições HTTP reais a uma rota Express de teste em uma porta temporária. Execute todos com `npm test`, ou apenas os testes HTTP com `node --test apps/api/test/rateLimit.http.test.ts`.

Implemente também `RateLimit.middleware()`, retornando um middleware Express que usa `req.ip` como chave. O contrato dos testes exige headers `RateLimit-Limit`, `RateLimit-Remaining` e `RateLimit-Reset` (segundos restantes arredondados para cima). Ao bloquear, deve retornar status `429`, header `Retry-After` em segundos e JSON `{ "error": "Too many requests." }`, sem executar o handler da rota. Os headers de quota seguem o formato separado conhecido como draft-6, escolhido para este exercício, não o formato combinado draft-8.

Os testes verificam recuperação após expiração, requisições concorrentes, isolamento de clientes atrás de um proxy confiável e que `X-Forwarded-For` não permite contornar o limite quando o proxy não é confiável. Não dependem da API ou do Docker em execução e não alteram as rotas da aplicação.

Referências: [HTTP 429 e Retry-After](https://www.rfc-editor.org/rfc/rfc6585.html#section-4) e [formatos de headers do express-rate-limit](https://github.com/express-rate-limit/express-rate-limit).

## Models and migrations

`config/database.ts` owns the connection. `config/models/index.ts` provides
`defineModel<T>(collectionName)` with `create`, `findOne`, `find`, `updateOne`,
`deleteOne`, and a typed `collection()` escape hatch for driver operations.
Models live in `features/<feature>/<feature>.model.ts`; importing them does not
connect or alter the database. Connect before calling model methods.

Collections, validators and indexes belong in versioned migrations under
`apps/api/migrations/`. Register new migrations in `migrations/index.ts`.
`001-create-urls` creates the collection validator and a unique `shortCode` index.

```bash
# MONGODB_URI must point to a reachable MongoDB database.
npm run migrate -w @shortener/api
# For the built Docker API (uses the internal MongoDB URL):
docker compose exec api npm run migrate:production -w @shortener/api
```

The runner applies migrations in ID order and records successful IDs in
`_migrations`. Do not modify applied migrations; add a new migration instead.
Migrations must tolerate retries: schema operations and the history write are
not transactional. A lock prevents concurrent runners. If a process crashes,
verify no migration runner is active before manually removing the `schema`
document from `_migration_locks`. There is no automatic rollback.

For example, a future migration can add an index with:

```ts
await db.collection('urls').createIndex(
  { createdAt: -1 },
  { name: 'urls_createdAt_desc' },
);
```

Add indexes for actual query patterns. The unique short-code index already
supports redirect lookup. Indexes consume storage and add work to writes.
TypeScript model types provide compile-time checks; migration validators enforce
stored document shape in MongoDB.

MongoDB model integration tests use a temporary database and require
`MONGODB_TEST_URI`; otherwise that test is skipped. Existing rate-limit HTTP
tests require a running Redis instance.

## URL endpoints and idempotency

Apply migrations before serving traffic (`npm run migrate -w @shortener/api`).

- `POST /api/links`: accepts `{ originalUrl, shortCode? }`; returns 201 on creation,
  or 200 with the original creation response on replay.
- `GET /api/links/:shortCode`: returns the current destination, or 404.
- `PUT /api/links/:shortCode`: accepts `{ originalUrl }`, atomically replaces the
  destination, and returns 200; unknown/deleted links return 404. Codes cannot be renamed.
- `DELETE /api/links/:shortCode`: returns 204, including for already deleted or
  unknown codes. Deletion retains a tombstone and permanently reserves the code.

POST optionally accepts `Idempotency-Key` (1–200 visible ASCII characters).
The key is globally scoped because this app has no authentication. Reusing it with
changed normalized URL or requested code returns 409. Without a key, the normalized
URL plus requested code identify a request. Different aliases or explicit keys
can create separate links to the same destination; an occupied requested code
returns 409. Codes are case-sensitive and contain 1–64 ASCII letters/digits.

Request identity and creation response are persisted together in the URL document.
Unique indexes arbitrate races across instances; generated-code collisions retry
up to five times. Replays preserve the original body after updates and deletion
and never resurrect deleted links. Replay status is 200 and `Idempotency-Replayed`
is true; the initial status is 201. Creation keys do not expire.

PUT is idempotent by assigning the same destination, not by replaying a saved
response. Concurrent different updates use last-write-wins semantics. DELETE is
idempotent by keeping the tombstone. Idempotency-Key applies only to POST.
Without authentication, anyone with a code can update or delete it.

Only HTTP(S) URLs without credentials are accepted. Input and normalized output
are limited to 2048 characters. Query ordering and fragments are preserved.
Migration 003 adds the request-identity index and removes destination uniqueness.
Legacy documents have no request identity and are not automatically deduplicated
with new submissions. Migration 002 still requires explicit reconciliation of
any legacy duplicate destinations before the migration chain can complete.

To run MongoDB integration tests, set MONGODB_TEST_URI to a reachable MongoDB URI.
Tests create and remove isolated temporary databases. Redis is also required
for the rate-limit tests when running the full suite.

## List links

`GET /api/links?page=1&limit=20&shortCut=MyLink` returns a success response
with `data` (an array of links) and `pagination: { page, limit, total, pages }`.
`shortCut` is an optional exact, case-sensitive short-code filter. Defaults are
page 1 and limit 20; maximums are page 10000 and limit 100. Invalid, repeated,
or unknown query parameters return 400. Deleted links are excluded.
Results sort by createdAt descending, then _id descending for deterministic ties.
Out-of-range pages return an empty array; an empty result has zero pages.
Migration 004 adds the index supporting this sort.
Offset pagination and the total count are separate reads, so concurrent writes
can shift pages and make the count differ from the items observed. Consider
cursor pagination for larger datasets or stronger consistency requirements.

## Replica-set simulation

See [the replica-set lab](docs/replica-simulation.md) for repeatable concurrency,
latency and primary failover experiments. `compose.replica.yaml` isolates the lab
from your application database. Run `docker compose build api`, followed by
`docker compose -f compose.replica.yaml run --rm simulation`.

## React link manager

The Vite/React web app lists links with infinite scrolling (20 records per API
page), exact short-code filtering, and a manual Load more fallback. A shared
`Modal` component uses native dialog focus containment and Escape handling.
Create supports an optional custom code and retains the same Idempotency-Key
across retries of unchanged form data. Details and edit fetch the current link
from the API; saving refreshes the list. Loading, empty and error states include
retry controls. The UI links to original destinations; redirect routes are not
implemented by this frontend.

Run `npm run dev -w @shortener/web` with the API available on localhost:3000.
Open http://localhost:5173. Vite proxies API requests to Express. For Docker,
rebuild the frontend with `docker compose up --build -d web`.
