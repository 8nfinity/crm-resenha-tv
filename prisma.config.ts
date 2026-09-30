import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Configuração do Prisma CLI (migrations e seed).
 *
 * No Prisma 7 a connection string saiu do schema.prisma e vive aqui. O runtime
 * do app não usa este arquivo — ele conecta pelo driver adapter em lib/db.ts.
 *
 * DATABASE_URL aponta para o pooler do Supabase (porta 6543). Migrations não
 * funcionam através de um pooler em modo transaction, então DIRECT_URL (porta
 * 5432) entra como shadowDatabaseUrl e como destino das migrations.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
