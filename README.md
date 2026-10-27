# Devias

Devias is a platform for building operations software around each customer's business. Instead of fitting a business into a fixed CRM or ERP, you model how it actually runs (its records, workflows, views and automations) and run it all as one system: a **studio** you compose in code, **modules** that ship objects, views, layouts and server functions with stable ids, a metadata-driven data engine, and **agents** that work in the context of that model.

![The studio: home, the sidebar and the assistant](assets/product-shot.png)

## What it is

- **Modules.** Each area of the business is a module: the CRM (people, companies and deals), quotes, invoicing, expenses, products and inventory ship in this repo. A module can also connect to an outside service by declaring connections (an encrypted API key for the workspace, or each person's own OAuth account), actions and events; Stripe payments and Email via Resend are such modules. A new workspace starts with the core modules only; install the others from Settings → Modules.
- **Records.** Everything a module models is an object with typed fields (text, numbers, dates, selects, relations, members, rich text and more), shown in tables, kanban boards and record pages. People can also **import a CSV file** into any object: match the columns, check the file without writing anything, then import.
- **Work that is not a record.** Tasks (for people and agents, as a list or a board), documents (rich text with comments and @mentions) and comments on records, all linkable from each other.
- **Workflows.** Automations without code: a trigger (a record change, a manual action on a record, a schedule, or an event a module delivers) and steps that update or create records, run a module's action, notify people or branch, with a run history per workflow.
- **Notifications.** Part of core: workflows, every module's actions and agents send them, and people read them behind the bell in the studio.
- **Agents.** An agent is its tool list plus whether each tool asks first. A workspace has a default assistant, makes its own agents (or starts from a template), and modules ship theirs, such as the CRM's Sales agent. Agents work in the context of the workspace's model, take tasks, ask questions with `ask_user`, and draw approval cards for what they want to change. **Skills** are procedures the workspace (or a module) writes once and agents load only when a request calls for them.

## Quick start

```bash
pnpm install
pnpm dev            # API on http://localhost:3000 (embedded PGlite, no setup) + studio on http://localhost:5173
```

Sign up in the studio and create a workspace, then install the CRM and the other modules you want from Settings → Modules. Export `ANTHROPIC_API_KEY` (or put it in `.env` at the repo root, which the server reads) to enable agents (⌘J in the studio). Agents also run on Gemini or OpenAI: set `AI_PROVIDER=google` with `GEMINI_API_KEY`, or `AI_PROVIDER=openai` with `OPENAI_API_KEY`. [`.env.example`](.env.example) lists every setting.

Other commands:

```bash
VITE_MOCK=1 pnpm dev:studio         # studio alone on an in-memory mock backend
pnpm typecheck && pnpm test         # every package
pnpm lint                           # Biome
docker compose up -d postgres       # optional real Postgres on :5433, then DATABASE_URL=postgres://devias:devias@localhost:5433/devias
pnpm smoke:api                      # end-to-end API check against a running server (sign-up → workspace → records → SSE → API key)
pnpm smoke:ui                       # headless-Chrome walk through the studio (needs Google Chrome installed), screenshots in .smoke/
pnpm db:generate / db:migrate       # create a migration after a schema change / apply migrations
pnpm sdk:generate                   # regenerate the SDK's API types from apps/server/openapi.json
```

After changing routes or actions, regenerate the API description (`apps/server/openapi.json` is the core API; `apps/server/openapi.with-modules.json` adds the routes of the configured modules and is what the documentation publishes) and the actions reference:

```bash
pnpm --filter @devias/server-app openapi:export
pnpm --filter @devias/server-app actions:export
pnpm sdk:generate
```

## Layout

| Path | Package | Purpose |
|---|---|---|
| `packages/core` | `@devias/core` | Shared contracts: metadata schemas, query IR, manifests, actions, `define*`, config merging, structure builder, the CSV reader and cell rules of imports |
| `packages/sdk` | `@devias/sdk` | Typed client (HTTP + SSE), query builder, in-memory mock backend |
| `packages/ui` | `@devias/ui` | Design tokens, shadcn components on Base UI, icons, layout primitives |
| `packages/studio` | `@devias/studio` | The studio runtime: router, shell, registries, view engine, record page, tasks, documents, workflows, agents, import, settings |
| `packages/data-engine` | `@devias/data-engine` | Server engine: metadata, JSONB data source, query compiler, records (batch, import), change feed, permissions, reconciler |
| `packages/ai` | `@devias/ai` | The agent runtime: model client, tools, approvals, persisted conversations, streamed turns |
| `packages/server` | `@devias/server` | Authoring API for the server side of a module: actions, connection tests and hooks, webhook, routes |
| `packages/fixtures` | `@devias/fixtures` | Neutral manifests that the packages' tests build on, so no package depends on a real module |
| `packages/cli` | `@devias/cli` | `devias plan / apply / dev / uninstall` |
| `apps/server` | `@devias/server-app` | Hono API with Better Auth |
| `apps/studio` | `@devias/studio-app` | The thin app that calls `defineStudio(...)` |
| `modules/crm` | `@devias/mod-crm` | The CRM itself (people, companies, deals), and its Sales agent |
| `modules/quotes` | `@devias/mod-quotes` | Quotes for the CRM's deals, with their items |
| `modules/invoicing` | `@devias/mod-invoicing` | Invoices, lines and payments on top of the CRM, a billing tool, and recalculate-invoice / add-payment actions |
| `modules/expenses` | `@devias/mod-expenses` | Expenses: what the business spends, by category, supplier and deal, from approval to reimbursement |
| `modules/products` | `@devias/mod-products` | Products: what you sell, and its prices, one time or recurring |
| `modules/inventory` | `@devias/mod-inventory` | Inventory: the stock of the products across locations, as moves in and out |
| `modules/payment-stripe` | `@devias/mod-payment-stripe` | Stripe as a payment provider: invoices paid online through a payment link, recorded once paid |
| `modules/email-resend` | `@devias/mod-email-resend` | Resend as an email provider: an API key connection, a send-email action, delivery events |

A module is a package with a manifest (objects, fields, views, layouts, navigation, agents), an optional `logo`, an optional `website`, and optionally server code (actions, connections, events). `modules/expenses` is the smallest example (a manifest only); `modules/payment-stripe` shows a connection with actions and events.

## License

Devias is mostly licensed under the [AGPL-3.0](LICENSE). The toolkit for working with it from outside (`packages/sdk`, `packages/ui` and `packages/cli`) is MIT, with a `LICENSE` file in each. Files marked `/* @license Enterprise */` are under the commercial license at the end of [`LICENSE`](LICENSE); none are marked yet.
