# 4Story Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web portal where the 5 players of a private 4Story server can register a game account, log in, and see their characters.

**Architecture:** Turborepo + npm workspaces monorepo. `apps/api` (NestJS) talks to the game's SQL Server with handwritten parameterized queries through the `mssql` driver and issues a JWT in an httpOnly cookie. `apps/web` (React + Vite) calls the API through Vite's `/api` proxy. `packages/shared` holds the Zod schemas and response types both apps use.

**Tech Stack:** Node 24, npm workspaces, Turborepo, TypeScript, NestJS, mssql, @nestjs/jwt, @nestjs/throttler, cookie-parser, Zod, React, Vite, Tailwind CSS v4 (`@tailwindcss/vite`), TanStack Router (file-based, `@tanstack/router-plugin`), TanStack React Query, Jotai, React Hook Form, `@hookform/resolvers`, Vitest, React Testing Library, unplugin-swc.

**Spec:** `docs/superpowers/specs/2026-10-31-4story-portal-design.md`. Read it before starting any task; this plan argues from it.

## Global Constraints

- Repo root: `C:\Users\stath\Projects\4story-portal`, branch `main`. Package manager: npm (pnpm is not installed).
- **Never write to `TGLOBAL_GSP` or `TGAME_GSP`.** All development, tests and manual checks use `TGLOBAL_GSP_TEST` and `TGAME_GSP_TEST`.
- **Task 3 Step 3 (creating the test copies) requires explicit user approval before it runs.**
- Database names come from `DB_GLOBAL_NAME` / `DB_GAME_NAME`, must match `^[A-Za-z0-9_]+$`, and are used as bracketed identifiers. Every value goes in as a query parameter.
- The API code contains no `UPDATE` or `DELETE` statements against game tables.
- The API never calls the `TLogin` stored procedure.
- Password hash: lowercase hex SHA-1 of the password's ASCII bytes, unsalted.
- Username: `^[A-Za-z0-9]{4,16}$`. Password: `^[\x20-\x7E]{6,16}$`.
- Register creates a `TACCOUNT_PW` row (`szUserID`, `szPasswd`, `bCheck = 0`) and a `TUSERINFOTABLE` row (`dwUserID`, `bCanCreateCharCount = 6`, `bAgreement = 1`) in one transaction, guarded by `SELECT ... WITH (UPDLOCK, HOLDLOCK)` on the username.
- Login failure message, exactly: `Invalid username or password` (same for unknown user and wrong password).
- Session cookie: name `session`, JWT `{ sub: userId, username }`, 7 days, `HttpOnly`, `SameSite=Lax`, `Path=/`, not `Secure`.
- Rate limits per IP: register 5 per hour, login 10 per minute.
- Error body shape: `{ statusCode: number, message: string, fieldErrors?: Record<string, string[]> }`. 500 responses use the message `Internal server error` and never include SQL, table names or stack traces.
- Ports: web 5173, API 3000. API global prefix `api`. Vite proxies `/api` to `http://localhost:3000`.
- `npm test` never touches a database. `npm run test:db` refuses to run unless both database names end in `_TEST`.
- Root `.env` is gitignored; `.env.example` is committed.
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Playwright is not installed in this plan.

## Review Focus

These failure modes are implied by the spec but easy to miss. Each has a test in the task named.

1. **Same name, different case.** Registering `PortalTest1` when `portaltest1` exists must return 409, because the game compares usernames case-insensitively. Pinned in Task 7 (real-database test against the `_TEST` copy).
2. **Login with different case.** Logging in as `MOOSE` for account `moose` must succeed, and the session must carry the stored spelling `moose`, not what was typed. Pinned in Task 5 (service test) and Task 7 (real-database lookup).
3. **Tampered or expired cookie.** A cookie with a bad signature or past expiry must get 401 on `/api/auth/me` and `/api/characters`, never a 500. Pinned in Task 5 (HTTP test).
4. **Database failure after startup.** If a repository throws a raw SQL error, the response must be a 500 with `Internal server error` and no driver text. Pinned in Task 5 (HTTP test).
5. **Character data with gaps.** A character with `NULL` dates and an unknown class, race or country code must render with `—` and `Unknown (<code>)`, not crash. Pinned in Task 6 (mapper test) and Task 10 (card test).

---

## File Structure

```
4story-portal/
├── package.json                 workspaces, root scripts (dev, build, lint, test, test:db)
├── turbo.json
├── tsconfig.base.json
├── .gitignore  .env.example  README.md
├── scripts/db/create-test-copies.sql
├── packages/shared/
│   ├── package.json  tsconfig.json  vitest.config.ts
│   └── src/
│       ├── index.ts             re-exports
│       ├── auth.ts              usernameSchema, passwordSchema, loginRequestSchema, registerRequestSchema, registerFormSchema
│       ├── auth.test.ts
│       └── api-types.ts         SessionUser, Character, ApiErrorBody
├── apps/api/
│   ├── package.json  tsconfig.json  nest-cli.json  vitest.config.ts  vitest.db.config.ts
│   ├── src/
│   │   ├── main.ts              bootstrap: env, cookie-parser, prefix, filter
│   │   ├── app.module.ts
│   │   ├── config/config.ts     loadConfig, AppConfig, CONFIG token
│   │   ├── db/db.service.ts     pool lifecycle, withTransaction, tableNames
│   │   ├── db/db.module.ts
│   │   ├── common/zod-validation.pipe.ts
│   │   ├── common/all-exceptions.filter.ts
│   │   ├── auth/sha1.ts
│   │   ├── auth/accounts.repository.ts   AccountsRepository interface + SqlAccountsRepository
│   │   ├── auth/auth.service.ts
│   │   ├── auth/session.service.ts       sign/verify JWT, cookie options
│   │   ├── auth/session.guard.ts         SessionGuard + CurrentUser decorator
│   │   ├── auth/auth.controller.ts
│   │   ├── auth/auth.module.ts
│   │   ├── characters/character-codes.ts className, raceName, countryName
│   │   ├── characters/characters.mapper.ts toCharacter
│   │   ├── characters/characters.repository.ts
│   │   ├── characters/characters.service.ts
│   │   ├── characters/characters.controller.ts
│   │   └── characters/characters.module.ts
│   └── test/
│       ├── *.test.ts            unit + HTTP tests (no database)
│       └── db/*.db.test.ts      real-database tests (_TEST only)
└── apps/web/
    ├── package.json  vite.config.ts  vitest.config.ts  index.html  eslint.config.js
    └── src/
        ├── main.tsx  index.css  routeTree.gen.ts (generated)
        ├── lib/api.ts            apiFetch, ApiError
        ├── lib/session.ts        meQueryOptions, useLogin, useRegister, useLogout
        ├── lib/characters.ts     charactersQueryOptions
        ├── lib/theme.ts          themeAtom
        ├── components/FormMessage.tsx  TextField.tsx  CharacterCard.tsx  ThemeToggle.tsx
        └── routes/
            ├── __root.tsx  index.tsx  login.tsx  register.tsx
            ├── _authed.tsx              guard + top bar
            └── _authed/characters.tsx
```

---

### Task 1: Monorepo skeleton and shared schemas

**Files:**
- Create: `package.json`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.env.example`
- Create: `packages/shared/{package.json,tsconfig.json,vitest.config.ts}`, `packages/shared/src/{index.ts,auth.ts,api-types.ts}`
- Test: `packages/shared/src/auth.test.ts`

**Interfaces:**
- Produces (from `@4story-portal/shared`):
  - `usernameSchema: z.ZodString`, `passwordSchema: z.ZodString`
  - `loginRequestSchema`, `registerRequestSchema`: `z.object({ username, password })`; types `LoginRequest`, `RegisterRequest`
  - `registerFormSchema`: `registerRequestSchema` plus `confirmPassword`, refined so it equals `password` (error on path `confirmPassword`, message `Passwords do not match`); type `RegisterForm`
  - `type SessionUser = { userId: number; username: string }`
  - `type Character` exactly as in spec section 6
  - `type ApiErrorBody = { statusCode: number; message: string; fieldErrors?: Record<string, string[]> }`

- [ ] **Step 1: Root files.** Root `package.json`: `"name": "4story-portal"`, `"private": true`, `"workspaces": ["apps/*", "packages/*"]`, scripts `dev`, `build`, `lint`, `test` each `turbo run <task>`, and `test:db` = `npm run test:db -w apps/api`. Dev dependency `turbo`. `turbo.json`: `build` depends on `^build` with outputs `dist/**`; `dev` is `persistent` and not cached; `lint` and `test` depend on `^build`. `.gitignore`: `node_modules`, `dist`, `.turbo`, `.env`, `coverage`, `*.log`. Do not ignore `apps/web/src/routeTree.gen.ts`; TanStack recommends committing it. `.env.example` lists every variable from spec section 4 with placeholder values and `DB_GLOBAL_NAME=TGLOBAL_GSP_TEST`, `DB_GAME_NAME=TGAME_GSP_TEST`. Set repo-local git identity: `git config user.name "Efstathios Stathopoulos"` and `git config user.email "stathopoulos.stathis98@gmail.com"`.

- [ ] **Step 2: Shared package config.** `packages/shared/package.json`: name `@4story-portal/shared`, `"type": "module"`, `"main"` and `"types"` point at `src/index.ts` (consumed as source), scripts `test` = `vitest run`, `lint` = `tsc --noEmit`. Dependencies `zod`; dev `vitest`, `typescript`.

- [ ] **Step 3: Write the failing test** `packages/shared/src/auth.test.ts`:

```ts
describe('usernameSchema', () => {
  it.each(['moose', 'Moose1', 'abcd', 'a'.repeat(16)])('accepts %s', (v) =>
    expect(usernameSchema.safeParse(v).success).toBe(true));
  it.each(['abc', 'a'.repeat(17), 'moo se', 'moose!', 'μoose', ' moose'])('rejects %s', (v) =>
    expect(usernameSchema.safeParse(v).success).toBe(false));
});
describe('passwordSchema', () => {
  it.each(['secret', 'a b c d', '!@#$%^', 'x'.repeat(16)])('accepts %s', (v) =>
    expect(passwordSchema.safeParse(v).success).toBe(true));
  it.each(['short', 'x'.repeat(17), 'pässword', 'tab\tpass'])('rejects %s', (v) =>
    expect(passwordSchema.safeParse(v).success).toBe(false));
});
describe('registerFormSchema', () => {
  it('rejects mismatched confirmation on confirmPassword', () => {
    const r = registerFormSchema.safeParse({ username: 'moose', password: 'secret1', confirmPassword: 'secret2' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]).toMatchObject({ path: ['confirmPassword'], message: 'Passwords do not match' });
  });
});
```

- [ ] **Step 4: Run** `npm install` at the root, then `npm test -w packages/shared`. Expected: FAIL (schemas not defined).

- [ ] **Step 5: Implement** `auth.ts` and `api-types.ts` with the regexes from Global Constraints, and re-export everything from `index.ts`.

- [ ] **Step 6: Run** `npm test -w packages/shared`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: monorepo skeleton and shared auth schemas"
```

---

### Task 2: API scaffold, config and database service

**Files:**
- Create: `apps/api` via `npx @nestjs/cli new api --directory apps/api --package-manager npm --skip-git --skip-install`, then remove Jest config, `test/app.e2e-spec.ts`, the sample controller/service and their spec.
- Create: `apps/api/vitest.config.ts`, `apps/api/src/config/config.ts`, `apps/api/src/db/{db.service.ts,db.module.ts}`
- Modify: `apps/api/src/{main.ts,app.module.ts}`, `apps/api/package.json`
- Test: `apps/api/test/config.test.ts`, `apps/api/test/table-names.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type AppConfig = { db: { host: string; port: number; user: string; password: string; globalName: string; gameName: string }; jwtSecret: string; apiPort: number }`
  - `loadConfig(env: Record<string, string | undefined>): AppConfig`: throws `Error` whose message names every invalid variable.
  - `CONFIG: unique symbol`, Nest provider token for `AppConfig`.
  - `tableNames(config: AppConfig): { accounts: string; userInfo: string; characters: string }` returning `[<global>].dbo.TACCOUNT_PW`, `[<global>].dbo.TUSERINFOTABLE`, `[<game>].dbo.TCHARTABLE`.
  - `class DbService implements OnModuleInit, OnModuleDestroy` with `pool: sql.ConnectionPool`, `tables: ReturnType<typeof tableNames>`, `withTransaction<T>(fn: (tx: sql.Transaction) => Promise<T>): Promise<T>` (commits on success, rolls back and rethrows on error).
  - `DbModule` (global) exporting `DbService`.

- [ ] **Step 1: Scaffold and wire Vitest.** Dependencies: `mssql`, `zod`, `dotenv`, `cookie-parser`, `@nestjs/jwt`, `@nestjs/throttler`, `@4story-portal/shared` (`"*"`); dev: `vitest`, `unplugin-swc`, `@swc/core`, `supertest`, `@types/supertest`, `@types/cookie-parser`, `@types/mssql`. Scripts: `test` = `vitest run`, `test:db` = `vitest run --config vitest.db.config.ts`, `lint` = `eslint . && tsc --noEmit`, `dev` = `nest start --watch`. `vitest.config.ts`: `plugins: [swc.vite({ module: { type: 'es6' } })]`, `test.include: ['test/**/*.test.ts']`, `test.exclude: ['test/db/**']`.

- [ ] **Step 2: Write the failing tests.** `config.test.ts`:

```ts
const valid = { DB_HOST: 'localhost', DB_PORT: '1433', DB_USER: 'sa', DB_PASSWORD: 'x',
  DB_GLOBAL_NAME: 'TGLOBAL_GSP_TEST', DB_GAME_NAME: 'TGAME_GSP_TEST',
  JWT_SECRET: 'a'.repeat(32), API_PORT: '3000' };
it('parses a valid environment', () =>
  expect(loadConfig(valid)).toMatchObject({ db: { port: 1433, globalName: 'TGLOBAL_GSP_TEST' }, apiPort: 3000 }));
it('names every missing variable', () =>
  expect(() => loadConfig({})).toThrow(/DB_HOST[\s\S]*JWT_SECRET/));
it.each(['TGLOBAL]; DROP', 'name with space', 'a.b'])('rejects database name %s', (name) =>
  expect(() => loadConfig({ ...valid, DB_GLOBAL_NAME: name })).toThrow(/DB_GLOBAL_NAME/));
it('rejects a short JWT secret', () =>
  expect(() => loadConfig({ ...valid, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/));
```

`table-names.test.ts`: `tableNames(loadConfig(valid))` equals `{ accounts: '[TGLOBAL_GSP_TEST].dbo.TACCOUNT_PW', userInfo: '[TGLOBAL_GSP_TEST].dbo.TUSERINFOTABLE', characters: '[TGAME_GSP_TEST].dbo.TCHARTABLE' }`.

- [ ] **Step 3: Run** `npm test -w apps/api`. Expected: FAIL (modules not found).

- [ ] **Step 4: Implement** `config.ts` (Zod schema over the env, `JWT_SECRET` min 32 chars, database names `^[A-Za-z0-9_]+$`), `tableNames`, and `DbService` (`mssql` config `{ server, port, user, password, options: { encrypt: false, trustServerCertificate: true } }`; connect in `onModuleInit`, close in `onModuleDestroy`). `main.ts`: load `.env` with `dotenv` from `path.resolve(process.cwd(), '../../.env')`, `setGlobalPrefix('api')`, `use(cookieParser())`, listen on `config.apiPort`. `AppModule` provides `CONFIG` via `loadConfig(process.env)` and imports `DbModule`. If `loadConfig` or the pool connection fails, the process logs the message and exits with code 1.

- [ ] **Step 5: Run** `npm test -w apps/api`. Expected: PASS.

- [ ] **Step 6: Commit** `feat(api): NestJS scaffold with config validation and database service`.

---

### Task 3: Test database copies

**Files:**
- Create: `scripts/db/create-test-copies.sql`
- Modify: `README.md` (create it with a "Test databases" section)

**Interfaces:**
- Produces: databases `TGLOBAL_GSP_TEST` and `TGAME_GSP_TEST` on `localhost\FOURSTORY`.

- [ ] **Step 1: Write the script.** For each pair (`TGLOBAL_GSP` → `TGLOBAL_GSP_TEST`, `TGAME_GSP` → `TGAME_GSP_TEST`):
  1. `BACKUP DATABASE [<src>] TO DISK = <InstanceDefaultBackupPath>\<src>_portal_copy.bak WITH COPY_ONLY, INIT`.
  2. `RESTORE FILELISTONLY` from that file into a temp table to get the logical data and log names.
  3. If the target exists, `ALTER DATABASE [<target>] SET SINGLE_USER WITH ROLLBACK IMMEDIATE`.
  4. `RESTORE DATABASE [<target>] FROM DISK = ... WITH REPLACE, MOVE <data> TO <InstanceDefaultDataPath>\<target>.mdf, MOVE <log> TO <InstanceDefaultDataPath>\<target>_log.ldf`.
  5. `ALTER DATABASE [<target>] SET MULTI_USER`.

  Paths come from `SERVERPROPERTY('InstanceDefaultBackupPath')` and `SERVERPROPERTY('InstanceDefaultDataPath')`; the statements are built with dynamic SQL using `QUOTENAME` for identifiers. Add a guard at the top: the script aborts (`THROW`) if any target name does not end in `_TEST`. The script never writes to the source databases.

- [ ] **Step 2: Review the script by reading it.** Confirm that only `BACKUP ... COPY_ONLY` touches the source databases and that every `RESTORE`/`ALTER` targets a `_TEST` name.

- [ ] **Step 3: STOP. Ask the user for approval to run the script.** Show them the two database names it will create and the backup/data paths. Do not continue without an explicit yes.

- [ ] **Step 4: Run** `sqlcmd -S "localhost\FOURSTORY" -E -C -b -i scripts/db/create-test-copies.sql`. Then verify with `sqlcmd ... -Q "SELECT name FROM sys.databases WHERE name LIKE '%_TEST'; SELECT COUNT(*) FROM TGLOBAL_GSP_TEST.dbo.TACCOUNT_PW; SELECT COUNT(*) FROM TGAME_GSP_TEST.dbo.TCHARTABLE;"`. Expected: both databases listed, counts 5 and 15 (the same as the real databases at the time of writing).

- [ ] **Step 5: README.** Document how to refresh the copies (re-run the script) and that `.env` must point at the `_TEST` names during development.

- [ ] **Step 6: Commit** `chore: script to create test copies of the game databases`.

---

### Task 4: Accounts and auth service

**Files:**
- Create: `apps/api/src/auth/{sha1.ts,accounts.repository.ts,auth.service.ts}`
- Test: `apps/api/test/sha1.test.ts`, `apps/api/test/auth.service.test.ts`

**Interfaces:**
- Consumes: `DbService` (Task 2), `RegisterRequest`, `LoginRequest`, `SessionUser` (Task 1).
- Produces:
  - `sha1Hex(input: string): string`: lowercase hex, input encoded as ASCII/latin1 bytes.
  - `type AccountRecord = { userId: number; username: string; passwordHash: string }`
  - `interface AccountsRepository { findByUsername(username: string): Promise<AccountRecord | null>; createAccount(username: string, passwordHash: string): Promise<number | null> }`. `createAccount` returns the new `dwUserID`, or `null` if the username is taken.
  - `ACCOUNTS_REPOSITORY: unique symbol` (injection token).
  - `class SqlAccountsRepository implements AccountsRepository` with an extra public `createAccountIn(tx: sql.Transaction, username: string, passwordHash: string): Promise<number | null>`; `createAccount` calls it inside `db.withTransaction`.
  - `class AuthService { register(input: RegisterRequest): Promise<SessionUser>; login(input: LoginRequest): Promise<SessionUser> }`. `register` throws `ConflictException('Username is already taken')`; `login` throws `UnauthorizedException('Invalid username or password')`.

- [ ] **Step 1: Write the failing tests.** `sha1.test.ts`:

```ts
it('matches the published vector for "abc"', () =>
  expect(sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d'));
it('hashes the empty string', () =>
  expect(sha1Hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709'));
it('returns lowercase hex', () => expect(sha1Hex('Secret!')).toMatch(/^[0-9a-f]{40}$/));
```

`auth.service.test.ts`, with an in-memory fake `AccountsRepository` whose `findByUsername` compares case-insensitively and returns the stored spelling (like the database collation):
  - `register({ username: 'newuser', password: 'secret1' })` resolves `{ userId: <id from fake>, username: 'newuser' }`, and the fake received `passwordHash === sha1Hex('secret1')`.
  - `register` with a name the fake reports as taken (`createAccount` returns `null`) rejects with `ConflictException`.
  - `login` with the right password resolves `{ userId, username }`.
  - `login` with a wrong password and `login` with an unknown user both reject with `UnauthorizedException` whose message is `Invalid username or password`.
  - Review Focus 2: account stored as `moose`; `login({ username: 'MOOSE', password })` resolves with `username: 'moose'`.

- [ ] **Step 2: Run** `npm test -w apps/api`. Expected: FAIL.

- [ ] **Step 3: Implement** `sha1Hex` with `node:crypto` (`createHash('sha1').update(input, 'latin1').digest('hex')`). `AuthService.login` compares hashes with `crypto.timingSafeEqual` over equal-length buffers. `SqlAccountsRepository` SQL:
  - `findByUsername`: `SELECT TOP 1 dwUserID, szUserID, szPasswd FROM <accounts> WHERE szUserID = @username`.
  - `createAccountIn`: `SELECT dwUserID FROM <accounts> WITH (UPDLOCK, HOLDLOCK) WHERE szUserID = @username`; if a row exists return `null`; else `INSERT INTO <accounts> (szUserID, szPasswd, bCheck) VALUES (@username, @hash, 0); SELECT CAST(SCOPE_IDENTITY() AS int) AS id`, then `INSERT INTO <userInfo> (dwUserID, bCanCreateCharCount, bAgreement) VALUES (@id, 6, 1)`.

- [ ] **Step 4: Run** `npm test -w apps/api`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(api): SHA-1 hashing, accounts repository and auth service`.

---

### Task 5: Auth HTTP layer (session cookie, guard, validation, errors, rate limits)

**Files:**
- Create: `apps/api/src/auth/{session.service.ts,session.guard.ts,auth.controller.ts,auth.module.ts}`, `apps/api/src/common/{zod-validation.pipe.ts,all-exceptions.filter.ts}`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/main.ts`
- Test: `apps/api/test/auth.http.test.ts`, `apps/api/test/test-app.ts` (helper)

**Interfaces:**
- Consumes: `AuthService`, `ACCOUNTS_REPOSITORY` (Task 4), `CONFIG` (Task 2), schemas and types (Task 1).
- Produces:
  - `SESSION_COOKIE = 'session'`
  - `class SessionService { sign(user: SessionUser): string; verify(token: string): SessionUser | null; cookieOptions(): CookieOptions }`. `verify` returns `null` for bad signature, expiry or malformed payload.
  - `class SessionGuard implements CanActivate`: reads `req.cookies.session`, sets `req.user: SessionUser`, throws `UnauthorizedException('Not signed in')` otherwise.
  - `CurrentUser` param decorator returning `SessionUser`.
  - `class ZodValidationPipe implements PipeTransform` constructed with a Zod schema; throws `BadRequestException` with body `{ statusCode: 400, message: 'Validation failed', fieldErrors }` (`fieldErrors` from `z.flattenError(...).fieldErrors`).
  - `class AllExceptionsFilter`: `HttpException` → its status with `ApiErrorBody`; anything else → logs the error, responds `{ statusCode: 500, message: 'Internal server error' }`. Registered globally in `main.ts`.
  - `createTestApp(overrides: { accounts?: AccountsRepository }): Promise<INestApplication>` in `test/test-app.ts`: builds `AppModule` with `DbService` replaced by a stub and the repository overridden; applies the same prefix, cookie-parser and filter as `main.ts`. Task 6 extends `overrides` with `characters?: CharactersRepository`.
  - Routes per spec section 6: `POST /api/auth/register` (201), `POST /api/auth/login` (200), `POST /api/auth/logout` (204), `GET /api/auth/me` (200, guarded).
  - Throttling: `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])`; `ThrottlerGuard` applied to register and login only, with `@Throttle({ default: { limit: 5, ttl: 3_600_000 } })` on register and `@Throttle({ default: { limit: 10, ttl: 60_000 } })` on login.

- [ ] **Step 1: Write the failing tests** `auth.http.test.ts` (supertest against `createTestApp` with the in-memory fake repository from Task 4):
  - Register valid → 201, body `{ userId, username }`, `set-cookie` contains `session=` and `HttpOnly` and `SameSite=Lax`.
  - Register `{ username: 'ab', password: 'x' }` → 400 with `fieldErrors.username` and `fieldErrors.password` arrays.
  - Register taken name → 409 `{ statusCode: 409, message: 'Username is already taken' }`.
  - Login right → 200 with cookie; login wrong password → 401 `Invalid username or password`.
  - `GET /api/auth/me` with the cookie from login → 200 `{ userId, username }`; without cookie → 401.
  - Logout → 204 and `set-cookie` clears `session` (expires in the past or `Max-Age=0`).
  - Review Focus 3: `/api/auth/me` with `session=<token signed with a different secret>` → 401; with a token signed with the right secret but `expiresIn: -10` → 401.
  - Review Focus 4: a repository whose `findByUsername` throws `new Error('Login failed for user sa; table TACCOUNT_PW')` → login returns 500 with body exactly `{ statusCode: 500, message: 'Internal server error' }`.
  - Rate limit: the 11th login within a minute from the same app → 429.

- [ ] **Step 2: Run** `npm test -w apps/api`. Expected: FAIL.

- [ ] **Step 3: Implement** the files listed. Register and login set the cookie with `res.cookie(SESSION_COOKIE, token, cookieOptions())` (`httpOnly: true, sameSite: 'lax', path: '/', maxAge: 7 days`) using `@Res({ passthrough: true })`. Logout calls `res.clearCookie(SESSION_COOKIE, { path: '/' })`.

- [ ] **Step 4: Run** `npm test -w apps/api`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(api): auth endpoints with session cookie, validation, error filter and rate limits`.

---

### Task 6: Characters endpoint

**Files:**
- Create: `apps/api/src/characters/{character-codes.ts,characters.mapper.ts,characters.repository.ts,characters.service.ts,characters.controller.ts,characters.module.ts}`
- Modify: `apps/api/src/app.module.ts`, `apps/api/test/test-app.ts` (add the `characters?: CharactersRepository` override)
- Test: `apps/api/test/characters.mapper.test.ts`, `apps/api/test/characters.http.test.ts`

**Interfaces:**
- Consumes: `DbService` (Task 2), `SessionGuard`, `CurrentUser`, `createTestApp` (Task 5), `Character` (Task 1).
- Produces:
  - `className(code: number): string`, `raceName(code: number): string`, `countryName(code: number): string`, using the tables in spec section 2; unknown codes give `Unknown (<code>)`.
  - `type CharacterRow = { dwCharID: number; bSlot: number; szNAME: string; bLevel: number; bClass: number; bRace: number; bCountry: number; dwGold: number; dwSilver: number; dwCooper: number; wMapID: number; dCreateDate: Date | null; dLogoutDate: Date | null }`
  - `toCharacter(row: CharacterRow): Character` (dates to ISO strings or `null`).
  - `interface CharactersRepository { listByUser(userId: number): Promise<CharacterRow[]> }`, token `CHARACTERS_REPOSITORY`, `SqlCharactersRepository`.
  - `GET /api/characters` (guarded) → `Character[]`.

- [ ] **Step 1: Write the failing tests.** `characters.mapper.test.ts`:
  - `className(0..5)` → `Warrior, Ranger, Archer, Wizard, Priest, Sorcerer`; `raceName(0..2)` → `Human, Beast, Nymph`; `countryName(0..4)` → `Defugel, Craxion, Country B, Neutral, Peace`.
  - Review Focus 5: `toCharacter` of a row with `bClass: 9, bRace: 7, bCountry: 12, dCreateDate: null, dLogoutDate: null` → `className: 'Unknown (9)'`, `race: 'Unknown (7)'`, `country: 'Unknown (12)'`, `createdAt: null`, `lastLogoutAt: null`.
  - A full row maps `dwCooper` to `money.copper` and dates to ISO strings.

  `characters.http.test.ts`: without cookie → 401; with a session for user 7, the fake repository is called with `7` and the response is the mapped list.

- [ ] **Step 2: Run** `npm test -w apps/api`. Expected: FAIL.

- [ ] **Step 3: Implement.** Repository SQL: `SELECT dwCharID, bSlot, szNAME, bLevel, bClass, bRace, bCountry, dwGold, dwSilver, dwCooper, wMapID, dCreateDate, dLogoutDate FROM <characters> WHERE dwUserID = @userId AND bDelete = 0 ORDER BY bSlot`.

- [ ] **Step 4: Run** `npm test -w apps/api`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(api): characters endpoint`.

---

### Task 7: Real-database tests against the `_TEST` copies

**Files:**
- Create: `apps/api/vitest.db.config.ts`, `apps/api/test/db/guard.setup.ts`, `apps/api/test/db/accounts.db.test.ts`, `apps/api/test/db/characters.db.test.ts`

**Interfaces:**
- Consumes: `loadConfig`, `tableNames`, `DbService` (Task 2), `SqlAccountsRepository.createAccountIn`, `findByUsername` (Task 4), `SqlCharactersRepository` (Task 6). Requires Task 3's databases.

- [ ] **Step 1: Guard.** `vitest.db.config.ts` includes only `test/db/**/*.db.test.ts`, uses `guard.setup.ts` as `setupFiles`, and runs files sequentially. `guard.setup.ts` loads the root `.env` and throws `Refusing to run: DB_GLOBAL_NAME and DB_GAME_NAME must end in _TEST` unless both names end in `_TEST`.

- [ ] **Step 2: Write the tests.** `accounts.db.test.ts`: each test opens a transaction on a real `DbService` and **always rolls back** in `finally`:
  - `createAccountIn(tx, 'PortalTest1', sha1Hex('secret1'))` returns a number; within the same transaction the `TACCOUNT_PW` row has lowercase 40-char `szPasswd` and `bCheck = 0`, and the `TUSERINFOTABLE` row has `bAgreement = 1`, `bCanCreateCharCount = 6`.
  - Review Focus 1: after that, `createAccountIn(tx, 'portaltest1', ...)` returns `null`.
  - After rollback, `findByUsername('PortalTest1')` (outside the transaction) returns `null`.
  - Review Focus 2: `findByUsername('MOOSE')` returns `username: 'moose'` (read-only; relies on the copy containing the account `moose`).

  `characters.db.test.ts`: `listByUser(<moose's dwUserID from findByUsername>)` returns 3 rows, all with `bDelete = 0` semantics (the query filters them).

- [ ] **Step 3: Run** `npm run test:db`. Expected: PASS. Then temporarily set `DB_GLOBAL_NAME=TGLOBAL_GSP` in the shell and run again. Expected: FAIL immediately with the guard message, before any connection.

- [ ] **Step 4: Commit** `test(api): rolled-back real-database tests for the _TEST copies`.

---

### Task 8: Web scaffold with tooling, API helper and theme

**Files:**
- Create: `apps/web` via `npm create vite@latest apps/web -- --template react-ts`; remove the demo content.
- Create: `apps/web/vitest.config.ts`, `apps/web/src/test/setup.ts`, `apps/web/src/lib/{api.ts,theme.ts}`, `apps/web/src/components/ThemeToggle.tsx`, `apps/web/src/routes/__root.tsx`
- Modify: `apps/web/{package.json,vite.config.ts,eslint.config.js,src/main.tsx,src/index.css,index.html}`
- Test: `apps/web/src/lib/api.test.ts`

**Interfaces:**
- Consumes: `ApiErrorBody` (Task 1).
- Produces:
  - `class ApiError extends Error { status: number; fieldErrors?: Record<string, string[]> }`
  - `apiFetch<T>(path: string, init?: RequestInit): Promise<T>`: prefixes `/api`, sends `credentials: 'same-origin'` and JSON headers, returns `undefined` for 204, throws `ApiError` (message from the body, or `Request failed` if the body is not JSON).
  - `themeAtom = atomWithStorage<'light' | 'dark'>('theme', 'dark')`; the root applies the `dark` class on `<html>` when dark.
  - Router context type `{ queryClient: QueryClient }` created with `createRootRouteWithContext`.

- [ ] **Step 1: Install and configure.** Dependencies: `@tanstack/react-router`, `@tanstack/react-query`, `jotai`, `react-hook-form`, `@hookform/resolvers`, `zod`, `@4story-portal/shared`; dev: `@tanstack/router-plugin`, `tailwindcss`, `@tailwindcss/vite`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`. `vite.config.ts`: plugins in order `tanstackRouter({ target: 'react', autoCodeSplitting: true })`, `react()`, `tailwindcss()`; `server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } }`. Scripts: `dev` = `vite`, `test` = `vitest run`, `lint` = `eslint . && tsc -b --noEmit`. Tailwind: `@import "tailwindcss";` and `@custom-variant dark (&:where(.dark, .dark *));` in `index.css`.

- [ ] **Step 2: Choose the visual direction.** Define the palette and fonts once as Tailwind `@theme` tokens in `index.css`: dark default, light supported, one accent colour, a display font for headings and a readable body font (loaded from Google Fonts in `index.html`). Use only these tokens in later tasks.

- [ ] **Step 3: Write the failing test** `api.test.ts` (stub `globalThis.fetch` with `vi.fn`):
  - 200 JSON → resolves the parsed body; request URL is `/api/auth/me`, `credentials` is `'same-origin'`.
  - 204 → resolves `undefined`.
  - 409 with `{ statusCode: 409, message: 'Username is already taken' }` → rejects `ApiError` with `status 409` and that message.
  - 400 with `fieldErrors` → `ApiError.fieldErrors` equals them.
  - 500 with a non-JSON body → `ApiError` with `status 500`, message `Request failed`.

- [ ] **Step 4: Run** `npm test -w apps/web`. Expected: FAIL.

- [ ] **Step 5: Implement** `api.ts`, `theme.ts`, `ThemeToggle.tsx`, `__root.tsx` (layout shell, theme class, not-found component with a link home, error component with a reload button), and `main.tsx` (QueryClient, router with context, `RouterProvider`).

- [ ] **Step 6: Run** `npm test -w apps/web` and `npm run lint -w apps/web`. Expected: PASS, no lint errors.

- [ ] **Step 7: Commit** `feat(web): Vite app with Tailwind, router, React Query, Jotai theme and API helper`.

---

### Task 9: Web login and register

**Files:**
- Create: `apps/web/src/lib/session.ts`, `apps/web/src/components/{FormMessage.tsx,TextField.tsx}`, `apps/web/src/routes/{index.tsx,login.tsx,register.tsx,_authed.tsx}`
- Test: `apps/web/src/routes/login.test.tsx`, `apps/web/src/routes/register.test.tsx`, `apps/web/src/routes/guards.test.tsx`, `apps/web/src/test/render-route.tsx` (helper)

**Interfaces:**
- Consumes: `apiFetch`, `ApiError`, router context (Task 8); `loginRequestSchema`, `registerFormSchema`, `SessionUser` (Task 1).
- Produces:
  - `meQueryOptions`: `queryKey: ['me']`, resolves `SessionUser | null` (`null` on 401), `staleTime: Infinity`.
  - `useLogin()`, `useRegister()`: mutations that set `['me']` to the returned user and navigate to `/characters`. `useRegister` posts only `{ username, password }`.
  - `useLogout()`: posts logout, clears the query cache, navigates to `/login`.
  - `_authed` layout route: `beforeLoad` uses `context.queryClient.ensureQueryData(meQueryOptions)` and redirects to `/login` when `null`; renders the top bar (username, `ThemeToggle`, **Log out**) and `<Outlet />`. `/login` and `/register` redirect to `/characters` when `me` is not `null`. `/` redirects by the same rule.
  - Global 401 handling: the QueryClient's `QueryCache`/`MutationCache` `onError` sets `['me']` to `null` and navigates to `/login` when an `ApiError` with status 401 comes from a query other than `['me']`.
  - `renderRoute(path: string, { me: SessionUser | null, fetch?: ... })` test helper: memory history, fresh QueryClient seeded with `['me']`.

- [ ] **Step 1: Write the failing tests.**
  - `login.test.tsx`: submitting empty shows the field errors from the schema; a mocked 401 shows `Invalid username or password` in the message box above the form; the submit button is disabled while the mocked request is pending; success navigates to `/characters`.
  - `register.test.tsx`: mismatched confirmation shows `Passwords do not match` under confirm password; a mocked 409 shows `Username is already taken` under the username field; a mocked 429 shows its message in the message box; the request body contains only `username` and `password`.
  - `guards.test.tsx`: `/characters` with `me: null` lands on `/login`; `/login` with a user lands on `/characters`; `/` goes to `/login` or `/characters` accordingly.

- [ ] **Step 2: Run** `npm test -w apps/web`. Expected: FAIL.

- [ ] **Step 3: Implement** the files. Forms use `useForm({ resolver: zodResolver(schema) })`; `ApiError.fieldErrors` and the 409 go through `setError` on the matching field; everything else goes to `FormMessage`.

- [ ] **Step 4: Run** `npm test -w apps/web` and `npm run lint -w apps/web`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): login and register pages with route guards`.

---

### Task 10: Web characters page

**Files:**
- Create: `apps/web/src/lib/characters.ts`, `apps/web/src/components/CharacterCard.tsx`, `apps/web/src/routes/_authed/characters.tsx`
- Test: `apps/web/src/components/CharacterCard.test.tsx`, `apps/web/src/routes/characters.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 8), `_authed` layout and `renderRoute` (Task 9), `Character` (Task 1).
- Produces:
  - `charactersQueryOptions`: `queryKey: ['characters']`, fetches `/characters`.
  - `CharacterCard({ character }: { character: Character })`.

- [ ] **Step 1: Write the failing tests.**
  - `CharacterCard.test.tsx`: renders name, `Lv. 45`, `Wizard`, `Human`, `Defugel`, money as `1,234` gold, `56` silver, `78` copper (`toLocaleString('en-US')`), `Map 12`, and the last logout date. Review Focus 5: with `createdAt: null`, `lastLogoutAt: null`, `className: 'Unknown (9)'` it renders `—` for last logout and shows `Unknown (9)`.
  - `characters.test.tsx`: loading shows the skeleton (`role="status"`); an empty list shows `No characters yet. Create one in the game.`; a list renders one card per character in slot order; a 500 shows an error and a **Retry** button that refetches; the top bar shows the username and **Log out** calls logout and lands on `/login`.

- [ ] **Step 2: Run** `npm test -w apps/web`. Expected: FAIL.

- [ ] **Step 3: Implement** the page as a responsive card grid using the Task 8 theme tokens.

- [ ] **Step 4: Run** `npm test -w apps/web` and `npm run lint -w apps/web`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): characters page`.

---

### Task 11: Full run and manual verification

**Files:**
- Modify: `README.md` (setup: copy `.env.example` to `.env`, fill in the `sa` password and a random `JWT_SECRET`; `npm install`; `npm run dev`; open `http://localhost:5173`; how to go live by changing the two database names)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Root checks.** Run `npm run build`, `npm run lint`, `npm test` at the root. Expected: all succeed through Turbo.

- [ ] **Step 2: Create `.env`** pointing at the `_TEST` databases (ask the user for the `sa` password or have them fill it in; generate `JWT_SECRET` with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Confirm both names end in `_TEST` before starting.

- [ ] **Step 3: Run the app** with `npm run dev`. In a browser at `http://localhost:5173`: register `PortalCheck1` / `check123`, land on `/characters` with the empty state, log out, log in again, refresh the page and stay signed in, try registering `portalcheck1` and see `Username is already taken`.

- [ ] **Step 4: Check the database (read-only, `_TEST` copy).** `SELECT dwUserID, szUserID, LEN(szPasswd), szPasswd COLLATE Latin1_General_CS_AS = LOWER(szPasswd) AS is_lower, bCheck FROM TGLOBAL_GSP_TEST.dbo.TACCOUNT_PW WHERE szUserID = 'PortalCheck1'` and the matching `TUSERINFOTABLE` row. Expected: length 40, lowercase, `bCheck = 0`, `bAgreement = 1`, `bCanCreateCharCount = 6`. Also confirm `szPasswd` equals `sha1Hex('check123')`.

- [ ] **Step 5: Commit** `docs: setup and run instructions`.

- [ ] **Step 6: Report to the user.** Include what was verified and remind them that the real proof is logging in to the game with a portal-created account, which needs `.env` pointed at the real databases (their decision).
