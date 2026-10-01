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

/**
 * Criptografia da conexão com o banco.
 *
 * Sem isto o `pg` conecta em texto puro: leads, conversas e hashes de senha
 * atravessariam a internet legíveis entre a hospedagem e o Supabase.
 *
 * O certificado do Supabase é assinado pela CA própria deles (não por uma
 * pública), então conferir o certificado exige o arquivo da CA: baixe em
 * Supabase → Project Settings → Database → SSL Configuration e cole o
 * conteúdo (PEM) na variável DATABASE_CA_CERT. Com ela, a conexão é
 * criptografada E autenticada. Sem ela, é criptografada sem conferir quem
 * está do outro lado — muito melhor que texto puro, e é o padrão.
 *
 * DATABASE_SSL=false desliga (só para um Postgres local sem TLS).
 */
function opcoesTls() {
  if (process.env.DATABASE_SSL === "false") return undefined;
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n").trim();
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
}

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não está definida — confira o .env");
  }

  const adapter = new PrismaPg({
    connectionString,
    ssl: opcoesTls(),
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

function cliente(): ReturnType<typeof createClient> {
  return (globalForPrisma.prisma ??= createClient());
}

/**
 * O cliente só nasce no primeiro uso, não ao importar este arquivo.
 *
 * O `next build` importa todas as rotas para ler a configuração delas; com o
 * cliente criado no import, o build exigia DATABASE_URL e quebrava sem ela
 * (num CI, ou numa hospedagem que só injeta as variáveis em tempo de execução).
 * Os métodos são amarrados ao cliente real, para nada dentro do Prisma enxergar
 * o intermediário.
 */
export const prisma = new Proxy({} as ReturnType<typeof createClient>, {
  get(_alvo, prop) {
    const real = cliente();
    const valor = Reflect.get(real, prop, real);
    return typeof valor === "function" ? valor.bind(real) : valor;
  },
});

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
