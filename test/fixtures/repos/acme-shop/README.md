# acme-shop

A small online shop: a storefront, an orders API, an admin panel and a background worker, kept in one monorepo.

## Overview

acme-shop is the example project used to test session-map. It is invented and has no real customers.

The shop is split in four apps and two packages:

- `apps/web` is the storefront, built with Next.js (App Router).
- `apps/admin` is the back office, built with Next.js (Pages Router).
- `apps/api` is the orders API, built with Fastify.
- `apps/worker` sends e-mails in the background with BullMQ.
- `packages/db` holds the Prisma data model.
- `packages/adapters` talks to the payment provider and the mailer.

## Features

- Browse the catalogue and open one order
- Place an order and get a receipt by e-mail
- Pay by card through the payment provider
- Scheduled daily digest e-mail
- Admin panel with a dashboard
- Health endpoint for uptime checks

## Getting started

### Requirements

- Node.js 20 or newer
- pnpm 9
- PostgreSQL 15 and Redis 7 running locally

### Install

```sh
pnpm install
cp .env.example .env
pnpm build
```

### Run

Start each app in its own terminal:

```sh
pnpm --filter api dev
pnpm --filter web dev
pnpm --filter worker dev
```

## Environment variables

Only names are listed here. Values live in `.env`, which is never committed.

| Name | Used by | What it is |
|---|---|---|
| `DATABASE_URL` | db | connection string of PostgreSQL |
| `REDIS_URL` | worker | connection string of Redis |
| `SESSION_SECRET` | api | signs the login cookie |
| `PORT` | api | port the API listens on |
| `API_BASE_URL` | web | where the storefront finds the API |
| `PAYMENTS_API_KEY` | adapters | key of the payment provider |
| `WORKER_CONCURRENCY` | worker | e-mails sent at the same time |

## API

All routes of the orders API live under `/v1`, except the status check.

| Method and path | What it does |
|---|---|
| `GET /status` | answers `ok` when the API is up |
| `GET /v1/orders/:id` | returns one order |
| `POST /v1/orders` | creates an order |
| `PUT /v1/orders/:id/note` | saves a note on an order |

## Data model

Three tables, described in `packages/db/prisma/schema.prisma`:

- a customer has many orders
- an order belongs to one customer
- an order can carry many tags, and a tag many orders

## Background jobs

The worker reads the `emails` queue:

- `welcome` is sent when an order is placed
- `digest` runs every day at 8:00

## Architecture

The map of the parts is in `docs/architecture/`, one file per part. Update it whenever a part changes.

## Testing

```sh
pnpm test
```

Each app has its own tests next to the code.

## Deployment

The apps are built by Turborepo and deployed one by one. Set the variables of the table above in the host first.

## Troubleshooting

### The API does not start

Check that `PORT` is free and that PostgreSQL answers on `DATABASE_URL`.

### Orders are created but no e-mail arrives

Check that the worker is running and that Redis answers on `REDIS_URL`.

### The storefront shows an empty page

Check that `API_BASE_URL` points to a running API.

### The build fails after a pull

Run `pnpm install` again; a package may have changed.

### A card charge is refused

Check the key of the payment provider and that the amount is above the minimum.

### The digest e-mail runs twice

Only one worker should schedule it; stop the extra one.

### The admin panel asks for a login again

The session secret changed; sign in once more.

### Prisma cannot find the client

Run the generate step of the db package, then build again.

### The health endpoint is slow

It does no work; look at the host, not at the code.

### Docs and code disagree

Treat the code as the truth and update the document in the same change.

### The API does not start (2)

Check that `PORT` is free and that PostgreSQL answers on `DATABASE_URL`.

### Orders are created but no e-mail arrives (2)

Check that the worker is running and that Redis answers on `REDIS_URL`.

### The storefront shows an empty page (2)

Check that `API_BASE_URL` points to a running API.

### The build fails after a pull (2)

Run `pnpm install` again; a package may have changed.

### A card charge is refused (2)

Check the key of the payment provider and that the amount is above the minimum.

### The digest e-mail runs twice (2)

Only one worker should schedule it; stop the extra one.

### The admin panel asks for a login again (2)

The session secret changed; sign in once more.

### Prisma cannot find the client (2)

Run the generate step of the db package, then build again.

### The health endpoint is slow (2)

It does no work; look at the host, not at the code.

### Docs and code disagree (2)

Treat the code as the truth and update the document in the same change.

### The API does not start (3)

Check that `PORT` is free and that PostgreSQL answers on `DATABASE_URL`.

### Orders are created but no e-mail arrives (3)

Check that the worker is running and that Redis answers on `REDIS_URL`.

### The storefront shows an empty page (3)

Check that `API_BASE_URL` points to a running API.

### The build fails after a pull (3)

Run `pnpm install` again; a package may have changed.

### A card charge is refused (3)

Check the key of the payment provider and that the amount is above the minimum.

### The digest e-mail runs twice (3)

Only one worker should schedule it; stop the extra one.

### The admin panel asks for a login again (3)

The session secret changed; sign in once more.

### Prisma cannot find the client (3)

Run the generate step of the db package, then build again.

### The health endpoint is slow (3)

It does no work; look at the host, not at the code.

### Docs and code disagree (3)

Treat the code as the truth and update the document in the same change.

### The API does not start (4)

Check that `PORT` is free and that PostgreSQL answers on `DATABASE_URL`.

### Orders are created but no e-mail arrives (4)

Check that the worker is running and that Redis answers on `REDIS_URL`.

### The storefront shows an empty page (4)

Check that `API_BASE_URL` points to a running API.

### The build fails after a pull (4)

Run `pnpm install` again; a package may have changed.

### A card charge is refused (4)

Check the key of the payment provider and that the amount is above the minimum.

### The digest e-mail runs twice (4)

Only one worker should schedule it; stop the extra one.

### The admin panel asks for a login again (4)

The session secret changed; sign in once more.

### Prisma cannot find the client (4)

Run the generate step of the db package, then build again.

### The health endpoint is slow (4)

It does no work; look at the host, not at the code.

### Docs and code disagree (4)

Treat the code as the truth and update the document in the same change.

### The API does not start (5)

Check that `PORT` is free and that PostgreSQL answers on `DATABASE_URL`.

### Orders are created but no e-mail arrives (5)

Check that the worker is running and that Redis answers on `REDIS_URL`.

### The storefront shows an empty page (5)

Check that `API_BASE_URL` points to a running API.

### The build fails after a pull (5)

Run `pnpm install` again; a package may have changed.

### A card charge is refused (5)

Check the key of the payment provider and that the amount is above the minimum.

### The digest e-mail runs twice (5)

Only one worker should schedule it; stop the extra one.

### The admin panel asks for a login again (5)

The session secret changed; sign in once more.

### Prisma cannot find the client (5)

Run the generate step of the db package, then build again.

### The health endpoint is slow (5)

It does no work; look at the host, not at the code.

### Docs and code disagree (5)

Treat the code as the truth and update the document in the same change.

### The API does not start (6)

Check that `PORT` is free and that PostgreSQL answers on `DATABASE_URL`.




## License

MIT, see `LICENSE`.
