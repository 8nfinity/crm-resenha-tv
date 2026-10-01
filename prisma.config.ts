import "dotenv/config";
import { defineConfig } from "prisma/config";

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
    // `prisma generate` (que roda no build) carrega este arquivo mas não
    // conecta em nada; exigir a variável ali quebrava o build sem banco. Sem
    // DIRECT_URL, uma migration falha tentando o host abaixo — cujo nome já
    // diz o que falta.
    url: process.env.DIRECT_URL || "postgresql://defina-a-DIRECT_URL@faltando-DIRECT_URL:5432/postgres",
  },
});
