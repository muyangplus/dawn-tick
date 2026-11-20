# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

晓刻 DawnTick: a timetable and reminder app shipped to three targets (Web, Windows via Tauri 2, Android via Capacitor) from one React UI. Docs, UI copy, comments and commit messages are in Chinese.

## Commands

Requires Node ≥ 24 and pnpm 12. Tests run `.ts` directly via `node --test` (Node's native type stripping), with no build step.

```bash
pnpm install
pnpm -C apps/web dev --host 127.0.0.1   # web dev server
pnpm test                               # core + web + tools tests
pnpm typecheck                          # tsc across the workspace
pnpm ui:smoke                           # jsdom smoke test of the UI (tools/verify/smoke-ui.mjs)
pnpm -C packages/core test              # one package
node --test packages/core/test/weeks.test.ts   # one test file
python tools/schema-check/validate_schema.py   # replay SQL schema + migrations on SQLite
node tools/release/version.mjs --check  # version consistency across apps (CI runs this)
```

- The product's home time zone is `Asia/Shanghai`; the smoke pins it. CI also runs `pnpm test` under `Asia/Kolkata` and `America/New_York`, so time assertions must not depend on the local offset.
- `pnpm test` also reruns the core suite on node:sqlite (`pnpm -C packages/core test:sqlite`, via `DT_TEST_STORAGE=sqlite` in `test/sqlite.env`) so FK/CHECK semantics are covered; SQLite-only known failures use `{ todo: sqliteTodo(...) }` from `test/kit`.
- Test files are discovered by glob (`node --test "test/**/*.test.ts"` per package, `"tools/**/*.test.mjs"` at the root). Keep the double quotes so Node, not the shell, expands the pattern (works under Windows cmd too).
- Other checks from `tools/verify/verify-all.ps1` (Windows/PowerShell, also covers builds, APK and cargo): `node tools/design/check-a11y.mjs`, `node --test tools/design/check-a11y.test.mjs` (tokens.ts ↔ styles.css consistency), `node tools/legal/collect-licenses.mjs --check`, `node tools/release/changelog.mjs --check`, `python tools/verify/check-workflows.py`.
- Desktop shell: `cargo check --all-targets --manifest-path apps/desktop/src-tauri/Cargo.toml` / `cargo test ...` (the Rust tests include DDL checks). Android: `pnpm -C apps/web build && pnpm -C apps/mobile exec cap sync android`, then `sh ./gradlew assembleDebug` in `apps/mobile/android`.

## Architecture

pnpm workspace: `packages/core` holds the platform-independent logic. `apps/web` is the single UI shared by all three targets. `apps/desktop` (Tauri/Rust) and `apps/mobile` (Capacitor/Android Java) are native shells around the web build.

**Storage abstraction.** `packages/core/src/storage.ts` defines `Storage`/`Collection`, a document-collection API over fixed stores (`users`, `semesters`, `time_slots`, `courses`, `course_schedules`, `events`, `reminders`, `app_meta`). Business logic depends only on this interface. Implementations:
- `core/sqlite-storage.ts` over a `SqlDriver` (`core/db.ts`). Drivers: `apps/web/src/db/tauri-driver.ts` (tauri-plugin-sql), `db/capacitor-driver.ts` (@capacitor-community/sqlite), `core/drivers/node-sqlite.ts` (tests/tools).
- `apps/web/src/db/idb-storage.ts` (IndexedDB) for the web.
- `db/active-driver.ts` / `db/platform.ts` pick the driver. `db/corrupt-guard.ts`, `health.ts`, `recover.ts` and `journal.ts` handle integrity checks and snapshot recovery.

All platform branching goes through `apps/web/src/platform-detect.ts` (`web` | `tauri` | `capacitor`). Don't scatter platform checks in UI code. Native calls go through `apps/web/src/lib/native.ts`, whose commands map one-to-one to Rust commands in `apps/desktop/src-tauri/src/` (`generate_handler!` and the migration list stay in `lib.rs`; each area — `storage`, `backup`, `logging`, `instance`, `tray`, `autostart`, `elevation`, `window_geometry`, `import_window`, `fs_commands`, `lan_*` — is its own module, re-exported from `lib.rs`). Windows-only code can be type-checked from Linux with `rustup target add x86_64-pc-windows-gnu` plus `gcc-mingw-w64-x86-64`, then `cargo check --target x86_64-pc-windows-gnu --all-targets`. Capacitor plugin contracts are in `apps/web/src/lib/plugins.ts` and `apps/mobile/docs/plugins.contract.md`.

**Schema and migrations.** DDL is defined only in `packages/core/src/schema/NNN_*.sql`. Desktop applies the migrations through tauri-plugin-sql (sqlx); Web and Android call `migrate` (`core/migrate.ts`) on every startup, which records `app_meta.schema_version`. Never edit a migration that has shipped; append a new one. A schema change must also update `001_init.sql`, `tools/schema-check/validate_schema.py`, the `exports` in `packages/core/package.json`, and the `include_str!` + `tauri_plugin_sql::Migration` list in `apps/desktop/src-tauri/src/lib.rs`.

**Time semantics** (see `docs/02-数据与存储.md`): instants are INTEGER UTC ms, dates are `YYYY-MM-DD` TEXT, class times are `HH:MM` TEXT interpreted in `semesters.time_zone`, and week sets are integer bitmaps (week N is bit N-1). The default display zone is `Asia/Shanghai`. Any time-related change needs test cases in `packages/core/test/`.

**Core modules:** `expand.ts` expands schedules into occurrences over weeks and holidays; `reminders.ts` and `search.ts` build on those occurrences; `mutations.ts` (a barrel over `mutations/{semesters,courses,events}.ts`, with shared write helpers in `mutations/base.ts`) and `repository.ts` handle writes and reads; `loadSemesterSnapshot` + `expandInputOf` read a semester once and build expansion input without further I/O. Writes are validated once: `validatedStorage` validates on `put`/`putMany` (batch uniqueness in one table read) and bumps `writeGeneration`, which the web data layer uses to reuse a snapshot on page flips. Settings live in a descriptor table in `settings.ts` (key, parse, encode, check). Every cross-device path (file import, WebDAV package, LAN sync, snapshot restore) goes through `importBackup` in `backup.ts` via `applyBackupPackage` (`apps/web/src/package.ts`): FK pre-check, last-write-wins on `updated_at` for merge, active-semester choice; `rev`/`dirty` columns exist but no row-level sync runs. Also `backup.ts` + `zip.ts`, and `import/` (ICS, CSV/Excel matrix, jwglxt academic systems, page-table recognition; both HTML table parsers share the rowspan/colspan-aware grid in `import/html-grid.ts`).

**Presets.** School timetables, academic-system configs and page parsers live in the separate repo `muyangplus/dawn-tick-presets`. A built-in snapshot sits in `packages/core/src/config/` (`builtin-preset-snapshot.json`, `preset-version.json`, `preset-hash.ts`) and is synced with `node tools/presets/sync-snapshot.mjs --from <presets repo>`. At runtime, preset updates are sha256-verified and fall back to the built-in snapshot.

**Web app layout** (`apps/web/src`): `main.tsx` → `App.tsx`. Startup, session and effects are in `app/`. Screens are in `screens/` and shared components in `components/` (`components/ui` primitives on Radix + Tailwind 4). Large forms keep one state object and put their reset/backfill/derivation logic in a pure sibling module tested from `apps/web/test` (`todo-form-model.ts`, `timetable/adjust-form.ts`, `period-settings-model.ts`); `data.ts` and `screens/cards/schedule-cards.tsx` are barrels over `data/` and one file per card. `mini/` is the separate `mini.html` entry used for the Windows floating widget. Vite has three inputs: `index.html`, `mini.html`, `import-submit.html`. Single sources of truth: UI copy in `copy/` (one module per page, shared phrases in `copy/common.ts`), course colors in `core/colors.ts`, design tokens in `design/tokens.ts`, which must match `styles.css`, `app_meta` helpers in `lib/meta.ts`, and meta keys in `lib/meta-keys.ts`. Backup keys derive from `SETTING_META_KEYS` in `core/settings.ts`. LAN sync is the `lan-sync-*.ts` / `lan-pair*.ts` family, with Rust counterparts `lan_*.rs` and the protocol spec in `apps/mobile/docs/lan-sync.contract.md`. Android home-screen widgets are fed from `widget-snapshot.ts`.

**Channels.** `dev` branch → dev channel (rolling `dev-latest`); `main` → beta (`vX.Y.Z-beta.N`) and release (`vX.Y.Z`). The build injects the channel through `DT_CHANNEL` (`__DT_CHANNEL__` in Vite). Features hidden per channel are listed in `FEATURES` in `apps/web/src/channel.ts`; update the smoke test when you change it. The version comes only from the root `package.json`, and `node tools/release/version.mjs` propagates it to the apps.

## 开发原则

- 所有需求动手前须经人工确认方案；完成后照常提交并推送到 `dev`，再由人工审阅，有问题再改。
- 需求有不清楚的地方，列出可选方案提问，不猜测意图。
- 测试脚本与功能模块不由同一个 agent 完成，可另开子 agent 分担其中之一，分工按任务灵活选择。

## Conventions

- Commits use `type(scope): 中文短句`, where type is feat / fix / chore / docs / refactor / test. Each commit does one thing. Don't write declarative or explanatory phrasing, in commit messages or in UI copy.
- Code comments are written for other developers, not as explanations for the machine.
- Accessibility: body text contrast ≥ 4.5:1, outlines ≥ 3:1, touch targets ≥ 44px (enforced by `tools/design/check-a11y.mjs`).
- When public behavior changes, update `docs/01`–`docs/06` and add an entry to `CHANGELOG.md`, which is the source of the release notes and is structure-checked.
- Before committing, `pnpm test` and `pnpm typecheck` must pass. New behavior needs tests.
