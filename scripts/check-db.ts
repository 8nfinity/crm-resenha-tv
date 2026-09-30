import "dotenv/config";
import { Client } from "pg";

/**
 * Diagnóstico da conexão com o banco: `npm run db:check`
 *
 * Existe porque os erros de conexão do Postgres são genéricos e apontam para o
 * lugar errado. "Can't reach database server" aparece igual quando a senha está
 * errada, quando a URL é a IPv6-only e quando o projeto do Supabase está
 * pausado — três problemas com soluções completamente diferentes.
 *
 * Este script separa esses casos e diz o que fazer em cada um.
 */

type Check = {
  nome: string;
  variavel: string;
  url: string | undefined;
  portaEsperada: string;
  usadoPor: string;
};

const RESET = "\x1b[0m";
const VERM = "\x1b[31m";
const VERDE = "\x1b[32m";
const AMAR = "\x1b[33m";
const CINZA = "\x1b[90m";

function ok(msg: string) {
  console.log(`  ${VERDE}OK${RESET}    ${msg}`);
}
function aviso(msg: string) {
  console.log(`  ${AMAR}AVISO${RESET} ${msg}`);
}
function erro(msg: string) {
  console.log(`  ${VERM}ERRO${RESET}  ${msg}`);
}
function dica(msg: string) {
  console.log(`        ${CINZA}${msg}${RESET}`);
}

/** Esconde a senha para a URL poder ser mostrada na tela com segurança. */
function mascarar(url: string): string {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:••••••@");
}

function analisarUrl(check: Check): boolean {
  const { nome, variavel, url, portaEsperada, usadoPor } = check;

  console.log(`\n  ${nome} (${variavel})`);

  if (!url) {
    erro(`${variavel} não está definida no .env`);
    return false;
  }

  if (url.includes("SEUPROJETO") || url.includes("SENHA")) {
    erro("ainda está com o valor de exemplo");
    dica("Abra o .env e cole a URL de verdade do painel do Supabase.");
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    erro("não é uma URL válida");
    dica("Copie a linha inteira do painel, sem quebrar em duas.");
    return false;
  }

  console.log(`        ${CINZA}${mascarar(url)}${RESET}`);

  // A "Direct connection" é IPv6-only no plano gratuito. É o erro mais caro
  // de diagnosticar porque a mensagem do Postgres não menciona IPv6.
  if (parsed.hostname.startsWith("db.") && parsed.hostname.endsWith(".supabase.co")) {
    erro("esta é a 'Direct connection', que é IPv6-only no plano gratuito");
    dica(`Troque pela '${usadoPor}' no botão Connect do painel do Supabase.`);
    dica("O host correto termina em .pooler.supabase.com");
    return false;
  }

  if (parsed.port !== portaEsperada) {
    erro(`porta ${parsed.port || "(nenhuma)"}, esperada ${portaEsperada}`);
    dica(`Você provavelmente colou a URL da outra opção. Use a '${usadoPor}'.`);
    return false;
  }

  // Em modo transaction o pgbouncer não suporta prepared statements; sem esta
  // flag o Prisma falha de forma intermitente, que é pior que falhar sempre.
  if (portaEsperada === "6543" && !url.includes("pgbouncer=true")) {
    aviso("falta ?pgbouncer=true no final");
    dica("Sem isso o Prisma quebra de vez em quando, o que é pior que quebrar sempre.");
  }

  ok("formato correto");
  return true;
}

async function testarConexao(check: Check): Promise<boolean> {
  if (!check.url) return false;

  const client = new Client({
    connectionString: check.url,
    connectionTimeoutMillis: 15000,
  });

  try {
    await client.connect();
    const res = await client.query("SELECT current_database() AS db, version()");
    ok(`conectou em "${res.rows[0].db}"`);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    erro(`não conectou: ${msg}`);

    // Tradução das mensagens do Postgres para o que realmente está errado.
    if (/password authentication failed/i.test(msg)) {
      dica("A senha está errada.");
      dica("Supabase → Project Settings → Database → Reset database password.");
      dica("Se a senha tem caracteres especiais (@ : / ?), ela precisa ser");
      dica("codificada na URL — gere uma senha só com letras e números.");
    } else if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) {
      dica("O endereço não existe ou o DNS não resolveu.");
      dica("Confira se o host está completo e sem espaços.");
    } else if (/ETIMEDOUT|ECONNREFUSED|timeout/i.test(msg)) {
      dica("O servidor não respondeu. As causas mais comuns:");
      dica("  1. O projeto do Supabase está pausado (projetos gratuitos");
      dica("     hibernam após 7 dias sem uso — reative pelo painel).");
      dica("  2. Você usou a 'Direct connection', que é IPv6-only.");
      dica("  3. Firewall ou rede corporativa bloqueando a porta.");
    } else if (/Tenant or user not found/i.test(msg)) {
      dica("O usuário está errado. No pooler ele é 'postgres.SEUPROJETO',");
      dica("não só 'postgres'. Copie a URL inteira do painel.");
    } else if (/self.signed|certificate/i.test(msg)) {
      dica("Problema de certificado TLS. Acrescente ?sslmode=require na URL.");
    }
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

/** Devolve o comando que falta rodar, ou null se o banco já está pronto. */
async function verificarTabelas(url: string): Promise<string | null> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    const res = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const tabelas = res.rows.map((r) => r.table_name);

    console.log("\n  Tabelas");
    if (tabelas.length === 0) {
      aviso("o banco está vazio");
      dica("Rode: npm run db:migrate");
      return "npm run db:migrate && npm run db:seed";
    }

    ok(`${tabelas.length} tabelas: ${tabelas.join(", ")}`);

    if (tabelas.includes("Stage")) {
      const estagios = await client.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM "Stage"',
      );
      const n = Number(estagios.rows[0].count);
      if (n === 0) {
        aviso("nenhum estágio no funil");
        dica("Rode: npm run db:seed");
        return "npm run db:seed";
      }
      ok(`${n} estágios configurados no funil`);
    }

    // Quantos leads já existem: é o que diz se falta importar conversas.
    if (tabelas.includes("Deal")) {
      const deals = await client.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM "Deal"',
      );
      const n = Number(deals.rows[0].count);
      if (n === 0) {
        console.log("\n  Funil");
        aviso("nenhum lead importado ainda");
        dica("Conecte o WhatsApp na tela Conexão e importe as conversas.");
      } else {
        console.log("\n  Funil");
        ok(`${n} leads no funil`);
      }
    }

    return null;
  } catch (e) {
    erro(`falha ao listar tabelas: ${e instanceof Error ? e.message : e}`);
    return null;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  console.log("\n  Diagnóstico do banco de dados");
  console.log("  " + "─".repeat(44));

  const checks: Check[] = [
    {
      nome: "Conexão do app",
      variavel: "DATABASE_URL",
      url: process.env.DATABASE_URL,
      portaEsperada: "6543",
      usadoPor: "Transaction pooler",
    },
    {
      nome: "Conexão das migrations",
      variavel: "DIRECT_URL",
      url: process.env.DIRECT_URL,
      portaEsperada: "5432",
      usadoPor: "Session pooler",
    },
  ];

  let tudoOk = true;

  for (const check of checks) {
    const formatoOk = analisarUrl(check);
    if (!formatoOk) {
      tudoOk = false;
      continue;
    }
    const conectou = await testarConexao(check);
    if (!conectou) tudoOk = false;
  }

  let proximoPasso: string | null = null;
  if (tudoOk && process.env.DIRECT_URL) {
    proximoPasso = await verificarTabelas(process.env.DIRECT_URL);
  }

  console.log("\n  " + "─".repeat(44));
  if (tudoOk) {
    if (proximoPasso) {
      console.log(`  ${VERDE}Banco acessível.${RESET} Próximo passo:`);
      console.log(`  ${CINZA}${proximoPasso}${RESET}\n`);
    } else {
      console.log(`  ${VERDE}Banco pronto.${RESET} Rode o CRM com:`);
      console.log(`  ${CINZA}npm run dev${RESET}   (ou dê duplo clique em iniciar.bat)\n`);
    }
  } else {
    console.log(`  ${VERM}Corrija os itens acima e rode de novo.${RESET}\n`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
