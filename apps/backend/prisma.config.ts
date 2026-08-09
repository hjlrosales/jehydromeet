// ============================================================
// Jehydro Meet — Prisma Configuration (Prisma v7+)
// ============================================================
// Prisma v7 moved datasource URL from schema.prisma to this
// config file. Paths are resolved relative to this file's
// location (apps/backend/).
//
// Prisma CLI auto-loads .env files, so no explicit dotenv
// import is needed here.
// ============================================================

import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
