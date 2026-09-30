import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Cliente do banco.
 *
 * O Prisma 7 removeu o engine em Rust: a conexão passa por um driver adapter
 * (`pg`) que recebe a connection string direto. Usamos a DATABASE_URL, que
 * aponta para o pooler do Supabase — obrigatório em serverless, onde cada
 * requisição pode abrir uma conexão nova e o Postgres estoura o limite sem pooler.
 *
 * O que pesa aqui é o custo de ABRIR uma conexão: com o banco em outra região,
 * o aperto de mão TLS leva mais de 1 segundo, contra ~200ms de uma consulta
 * numa conexão já aberta. O padrão do `pg` fecha conexões ociosas depois de
 * 10 segundos — ou seja, quase todo clique depois de uma pausa pagava esse
 * segundo extra. Por isso o pool guarda as conexões por bem mais tempo.
 */

const CONEXOES = 10;

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não está definida — confira o .env");
  }

  const adapter = new PrismaPg({
    connectionString,
    max: CONEXOES,
    idleTimeoutMillis: 30 * 60 * 1000,
    connectionTimeoutMillis: 20_000,
    // Sem keepalive, roteadores e o próprio pooler derrubam em silêncio uma
    // conexão parada, e a próxima consulta descobre isso do jeito lento.
    keepAlive: true,
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// Uma instância por processo, SEMPRE — não só em dev. Em dev o motivo é o
// reload a cada edição; em produção, o Next pode carregar este módulo mais de
// uma vez (um por pacote de rota), e cada cópia teria o próprio pool, frio.
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createClient();
globalForPrisma.prisma = prisma;

/**
 * Abre várias conexões de uma vez, antes de alguém precisar delas.
 *
 * As telas fazem até 7 consultas em paralelo (o funil); cada uma que encontra
 * o pool sem conexão livre paga o segundo de aperto de mão. Chamado ao subir o
 * servidor e periodicamente, para o pool nunca esfriar.
 */
export async function aquecerBanco(quantas = 8): Promise<void> {
  await Promise.all(
    Array.from({ length: quantas }, () => prisma.$queryRaw`SELECT 1`),
  );
}
