# Architecture

The repository uses sibling pnpm packages for the React client, NestJS API, and shared contracts. CRM navigation uses separate list, detail, and form routes. Zustand holds the current public user and acting staff selection in memory. The CRM context holds bootstrap data; route data hooks hold fetched detail records.

## Backend modules

Backend domains keep their implementation together. The [backend module index](../server/src/README.md) links to a README in every feature and supporting directory, describing its ownership, implementation files, collaborators, and transaction boundary.

- **Models** define typed entities and value objects, schema mappings, and local invariants. Order transitions, deliverable/returnable quantities, credit availability, cash-funded reward rounding, and charge balances have explicit model behavior.
- **Repositories** own database reads and writes using typed Drizzle tables, joins, predicates, aggregates, inserts, and updates. Repository modules expose persistence to cooperating domains without importing their business services or introducing circular service dependencies.
- **Services** authorize operations and coordinate domain work. Cash allocation belongs to Accounts; reward entitlement updates and point balances belong to Rewards. Fulfillment and Returns call those services when a physical operation changes settlement or entitlement. When a command shrinks a capacity that is already in use, Settlement's capacity reconciler releases the excess under the declared WF-003 order.
- **Controllers** handle HTTP parameters, runtime validation, and authenticated actors. Domain mutations retain the common action contract; domain read controllers expose their own records.

Use only the layers a capability needs. Catalog serves repository reads directly, Workspace returns static metadata without a repository or service, and Health keeps its single database readiness query in a service. These modules do not need the full business-module file layout.

`AppModule` imports the feature modules directly. `CrmQueriesService` owns only bootstrap and customer snapshot composition, assembling existing reads within SQLite read transactions. It has no domain model, repository, mutation methods, or compatibility forwarding methods. CLI seeding and integration fixtures call the owning services and repositories directly. Shared contracts are imported from `@crm/shared`; `database/schema.ts` is the single table export entry point for Drizzle tooling, with declarations kept in domain models.

`ActionsService` owns the synchronous immediate SQLite transaction. All repositories use the same connection, so cross-domain writes participate in that transaction. A nested savepoint rolls back domain changes on rejection or an unresolved choice while retaining the request outcome for idempotency. Audit enriches the resulting typed record changes and verifies the account before commit. No service executes an assembled SQL statement.

Small SQL expressions remain where Drizzle needs SQLite-specific expressions: schema constraints, insertion-order tie-breaking through `rowid`, and literal substring search. Complete SELECT, INSERT, and UPDATE statements use Drizzle's builders. Moving table declarations into models preserves the existing SQL schema and migrations.

```text
client/src/
  components/ui/  Owned shadcn/ui-style Radix components
  pages/          Customer, order, account, staff, and sign-in routes
  features/crm/   Record forms, account tables, and CRM data access
  store/          In-memory Zustand session state
  lib/            HTTP client and utilities
shared/src/       Zod request contracts, public response types, roles
```

Shared builds to an ESM package with declarations; both applications import its public package export. There are no source aliases between packages. NestJS is compiled with TypeScript decorator metadata, including in tests and development.

## Authentication

Passwords use Node.js scrypt with independent 16-byte salts, a 64-byte derived key, and parameters `N=32768, r=8, p=1`. Unknown accounts perform password verification against a dummy hash. Passwords are limited to 12–128 characters when accounts are created. Login accepts existing passwords up to that same maximum.

JWTs use HS256, a validated secret of at least 32 characters, an issuer, an audience, and an expiry. They contain a subject and session ID; the current role is read from the database on each request. The session cookie is HttpOnly, SameSite Strict, scoped to `/api`, and Secure in production. Tokens are never returned in response JSON or stored in localStorage. Zustand holds only the current public user in memory and hydrates from `/auth/me` on reload.

Every protected request verifies the JWT, checks its live database session, and reads the account status. Logout deletes that session. Admin changes to role or account status revoke every session belonging to the target user. Admins cannot change their own role or status; a second admin must do that. A transaction protects the last active admin.

The default session lifetime is eight hours. There is no refresh-token flow; expiry requires another sign-in. Expired session rows are pruned when a session is created. Email verification, password recovery, MFA, and external payment rails are outside this application’s scope.

Global Nest guards apply rate limiting, authentication, and then authorization. Only explicitly public routes bypass authentication. Public registration accepts no role field and always assigns Sales. Shared Zod schemas validate authentication, staff management, user-list queries, and CRM action envelopes and payloads. Customer creation uses a Zod schema in its domain controller. User responses explicitly select public columns. All active roles can read CRM records; services enforce mutation permissions, and action traces are limited to the requester, acting staff member, or Admin.

Browser writes must have the configured Origin, and cross-site Fetch Metadata is rejected. Non-browser clients may omit Origin. JSON content types are required for body-bearing writes. SameSite cookies and origin checks work together against CSRF, including login CSRF. Helmet supplies security headers; API responses disable caching. Credential endpoints have stricter IP-based limits. Rate limits are process-local, suitable for a single-instance starter.

## Database

SQLite uses `better-sqlite3` through Drizzle, with WAL, foreign keys, a busy timeout, unique emails, role/status checks, session foreign keys, and indexes. Database files are ignored by version control. `pnpm db:migrate` applies committed migrations; `pnpm db:generate` creates the next migration from the schema. Production startup does not mutate the schema.

## Configuration and deployment

| Variable              | Default                   | Purpose                                                      |
| --------------------- | ------------------------- | ------------------------------------------------------------ |
| `NODE_ENV`            | `development`             | `development`, `test`, or `production`                       |
| `PORT`                | `3000`                    | API port                                                     |
| `CLIENT_ORIGIN`       | `http://localhost:5173`   | Exact allowed HTTP(S) browser origin, without trailing slash |
| `DATABASE_PATH`       | `./data/crm-workspace.db` | SQLite file path, relative to the server working directory   |
| `JWT_SECRET`          | Required                  | Random secret of at least 32 characters                      |
| `SESSION_TTL_SECONDS` | `28800`                   | Session duration, 60–86400 seconds                           |

Build with `pnpm build`; run the API with `pnpm --filter @crm/server start`. Serve `client/dist` as static assets with SPA fallback to `index.html`, and proxy `/api` to NestJS under the same public origin. Vite’s proxy applies only in development. Apply migrations separately before starting a release. Preserve the `server/dist` and `server/drizzle` directories relative to `server/` for the migration command. Filtered pnpm server commands run in `server/`, where `.env` and relative database paths are resolved; use that same working directory if launching Node directly.

Production requires `NODE_ENV=production`, an HTTPS `CLIENT_ORIGIN`, TLS at the reverse proxy, a durable volume for SQLite, and a secret supplied by your environment. Keep frontend and API on the same public origin for this cookie configuration. Back up SQLite with an online backup or a consistent snapshot that includes WAL state. Changing `JWT_SECRET` signs out existing sessions.

The starter does not trust forwarded IP headers. If deploying behind a reverse proxy, configure Express trust for your specific proxy topology so IP throttling uses the correct client address; do not blindly trust arbitrary forwarding headers. Multi-instance deployments need a shared rate-limit store and a database architecture suitable for concurrent hosts.

Implementation references: [NestJS authentication](https://docs.nestjs.com/security/authentication), [Drizzle SQLite drivers](https://orm.drizzle.team/docs/get-started-sqlite), [shadcn/ui with Vite](https://ui.shadcn.com/docs/installation/vite), [Zustand stores](https://zustand.docs.pmnd.rs/reference/apis/create.html).

## Related

- [Documentation index](README.md)
- [Project overview](../README.md)
- [Development workflow](../CONTRIBUTING.md)
- [API reference](api.md)
- [Operations desk](operations.md)
- [Verification](verification.md)
- [Backend module index](../server/src/README.md)
