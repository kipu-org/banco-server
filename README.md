# Mi Banco Server

**Banking for the Unbanked**

> [!CAUTION]
> ## This project is deprecated and no longer maintained.
>
> It receives **no updates, bug fixes, or security patches**, and no support is provided. Running it, or relying on any hosted instance, is entirely at your own risk.
>
> Vulnerability reports are still read (see [`SECURITY.md`](./SECURITY.md)) but **will not be fixed here**.

## Running locally for development

### NestJS instance

1. `git clone` the repo
2. `cd` into the directory
3. Install packages with `pnpm install` (using node `v20.11.1`)
4. Start using `pnpm run start:dev`
5. Applications run on port 3000 by default: `localhost:3000`. Can be specified using the `PORT` env var.

### Postgres and Redis

`docker compose up -d` to start the postgres and redis container

### Run Prisma migrations

`npx prisma migrate dev --schema prisma/schema.prisma`

Please note that the Postgres url from the environment will be used, i.e. `.env` file

## Build for production

You can build this app using `pnpm run build`. Or use the [`Dockerfile`](./Dockerfile) to deploy this application.

## Deployed backend

[https://bancolibre.com/api/graphql](https://bancolibre.com/api/graphql)
