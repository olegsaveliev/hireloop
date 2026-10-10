import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// All settings live in .env.local (same file Next.js reads).
config({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
