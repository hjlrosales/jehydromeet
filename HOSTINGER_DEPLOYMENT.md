# Hostinger Deployment

Jehydro Meet is not a static-only site. It needs:

- A Next.js frontend Node app.
- An Express + Socket.IO backend Node app.
- PostgreSQL reachable from the backend.
- HTTPS in production so browser camera/microphone APIs work.

## Build Outputs

After a local build, the important output locations are:

- Frontend build: `apps/frontend/.next`
- Frontend public assets, including logo: `apps/frontend/public`
- Backend build: `apps/backend/dist`
- Shared runtime package build: `packages/shared-types/dist`
- Prisma schema: `apps/backend/prisma/schema.prisma`

Upload the whole repository to Hostinger if possible. That preserves the workspace dependency between `apps/backend`, `apps/frontend`, and `packages/shared-types`.

## Frontend App

Hostinger app root:

```text
apps/frontend
```

Build command:

```bash
NEXT_STANDALONE=false NEXT_PUBLIC_BACKEND_URL=https://YOUR_BACKEND_DOMAIN pnpm build
```

Start command:

```bash
NEXT_STANDALONE=false pnpm start
```

If Hostinger starts from the repository root instead of `apps/frontend`, use:

```bash
NEXT_STANDALONE=false pnpm --filter @jehydro/frontend start
```

## Backend App

Hostinger app root:

```text
apps/backend
```

Build from repository root:

```bash
pnpm --filter @jehydro/shared-types build
pnpm --filter @jehydro/backend build
```

Start command from `apps/backend`:

```bash
node dist/index.js
```

## Backend Environment Variables

Set these in Hostinger:

```text
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
CORS_ORIGIN=https://YOUR_FRONTEND_DOMAIN
PORT=4000
```

Optional but recommended:

```text
JWT_SECRET=change-this-to-a-long-random-secret
MAX_ROOMS_PER_IP_PER_HOUR=100
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

## Frontend Environment Variables

Set this before building the frontend:

```text
NEXT_PUBLIC_BACKEND_URL=https://YOUR_BACKEND_DOMAIN
```

This value is baked into the Next.js browser bundle, so rebuild the frontend after changing it.

## Notes

- Hostinger static file hosting alone is not enough for this app.
- Use two Node apps or two subdomains, for example `meet.example.com` for frontend and `api.example.com` for backend.
- The logo files are in `apps/frontend/public/logo.svg` and `apps/frontend/public/favicon.svg`.
