import { NextResponse, type NextRequest } from "next/server";
import { ipInCidr, secretsMatch } from "@/lib/ip";
import { COOKIE_SESSAO } from "@/lib/auth/sessao";
import { usuarioDoToken } from "@/lib/auth/usuario";
import { ehAdministrador } from "@/lib/auth/papeis";

/**
 * Porteiro de todas as requisições (convenção "proxy" do Next 16, ex-middleware).
 *
 * Duas portas diferentes:
 *
 * 1. O endpoint MCP (conector do Claude) tem proteção própria — segmento
 *    secreto na URL e faixa de IP da Anthropic — e NÃO passa pelo login.
 * 2. Todo o resto exige estar logado. Sem sessão válida, página vai para
 *    /login e rota da API responde 401.
 *
 * Ficam abertas só as rotas que têm a própria trava ou precisam estar:
 * o webhook da Evolution (segredo no header), a verificação de saúde da
 * hospedagem e o cron (segredo próprio). As rotas também conferem por conta
 * própria o que é de administrador — o proxy não é a única barreira.
 */

export const config = {
  // Tudo, menos arquivos estáticos (JS/CSS do Next, imagens, fontes, logo):
  // sem isso a própria tela de login viria sem estilo.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|fonts/|pdfjs/|sw\\.js|manifest\\.webmanifest).*)"],
};

/** Abertas sem login: cada uma tem a própria trava (ou é a tela de entrar). */
const ROTAS_ABERTAS = ["/login", "/api/auth/login", "/api/webhooks/evolution", "/api/saude", "/api/cron/recalc"];

function aberta(caminho: string): boolean {
  return ROTAS_ABERTAS.some((r) => caminho === r || caminho.startsWith(`${r}/`));
}

const sob = (caminho: string, base: string) => caminho === base || caminho.startsWith(`${base}/`);

/**
 * O que só master e administradores fazem — num lugar só, para dar para
 * auditar de uma olhada. Vendedor trabalha os leads (conversa, move, anota,
 * agenda, arquiva); a ESTRUTURA do CRM e o que é irreversível ficam aqui.
 */
function exigeAdministrador(request: NextRequest): boolean {
  const c = request.nextUrl.pathname;
  const leitura = request.method === "GET" || request.method === "HEAD";

  // Conexão do WhatsApp: conectar, remover número, importar conversas.
  if (sob(c, "/conexao") || sob(c, "/api/accounts")) return true;
  // Usuários (a rota também confere a hierarquia por conta própria).
  if (sob(c, "/api/usuarios")) return true;
  // Contatos ignorados: quem fica de fora do CRM é decisão de administrador.
  if (sob(c, "/api/contatos-ignorados")) return true;
  // Situação e teste dos avisos por e-mail.
  if (sob(c, "/api/avisos-email")) return true;
  // Estrutura: colunas do funil, campos próprios, conteúdo do playbook.
  if (!leitura && (sob(c, "/api/stages") || sob(c, "/api/custom-fields") || sob(c, "/api/playbook"))) return true;
  // Apagar um lead de vez reescreve as métricas; arquivar continua liberado.
  if (request.method === "DELETE" && /^\/api\/deals\/[^/]+$/.test(c) && request.nextUrl.searchParams.get("permanente") === "true") {
    return true;
  }
  return false;
}

/**
 * Proteção contra CSRF: um site de fora não pode disparar alterações usando o
 * login de quem está com o CRM aberto.
 *
 * Todo navegador moderno manda o cabeçalho Origin em POST/PATCH/DELETE. Se ele
 * existe e não é o próprio CRM, a requisição veio de outra página e é
 * recusada. Sem Origin (webhook, curl, o conector do Claude) não é navegador
 * — e esses têm as próprias travas. O cookie SameSite=Lax já barra a maioria
 * dos casos; esta é a segunda camada.
 */
function origemEstranha(request: NextRequest): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  const origem = request.headers.get("origin");
  if (!origem) return false;
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const permitidos = new Set([host, request.nextUrl.host]);
    if (process.env.APP_URL) permitidos.add(new URL(process.env.APP_URL).host);
    if (process.env.RAILWAY_PUBLIC_DOMAIN) permitidos.add(process.env.RAILWAY_PUBLIC_DOMAIN);
    return !permitidos.has(new URL(origem).host);
  } catch {
    return true; // Origin malformado
  }
}

export async function proxy(request: NextRequest) {
  const caminho = request.nextUrl.pathname;

  if (caminho.startsWith("/api/mcp")) return protegerMcp(request);

  if (origemEstranha(request)) {
    return NextResponse.json({ error: "Origem não permitida." }, { status: 403 });
  }

  if (aberta(caminho)) {
    // Quem já está logado e abre /login vai direto para o CRM.
    if (caminho === "/login" && (await usuarioDoToken(request.cookies.get(COOKIE_SESSAO)?.value))) {
      return NextResponse.redirect(new URL("/hoje", request.url));
    }
    return NextResponse.next();
  }

  const usuario = await usuarioDoToken(request.cookies.get(COOKIE_SESSAO)?.value);
  if (usuario) {
    if (exigeAdministrador(request) && !ehAdministrador(usuario.role)) {
      if (caminho.startsWith("/api/")) {
        return NextResponse.json({ error: "Só administradores podem fazer isso." }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/hoje", request.url));
    }
    return NextResponse.next();
  }

  if (caminho.startsWith("/api/")) {
    return NextResponse.json({ error: "Sessão expirada. Faça login de novo." }, { status: 401 });
  }

  const destino = new URL("/login", request.url);
  // Volta para onde a pessoa queria ir depois de entrar.
  if (caminho !== "/" && caminho !== "/hoje") destino.searchParams.set("de", caminho + request.nextUrl.search);
  return NextResponse.redirect(destino);
}

// ─── Endpoint MCP ────────────────────────────────────────────────────────────

/**
 * IP de origem da requisição.
 *
 * Confia no `x-real-ip` (e, na falta dele, no primeiro item de
 * `x-forwarded-for`), que o proxy da hospedagem escreve — na Railway e na
 * Vercel é a borda deles que define esses headers. Atrás de um proxy que NÃO
 * os sobrescreva, esta leitura seria falsificável pelo cliente; por isso a
 * trava de IP é a segunda camada, e o segmento secreto da URL é a primeira.
 */
function clientIp(request: NextRequest): string | null {
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  return null;
}

/**
 * O conector do claude.ai não usa OAuth aqui, então a porta é trancada por duas
 * coisas: um segmento secreto na URL e a faixa de IP de saída publicada pela
 * Anthropic (160.79.104.0/21).
 *
 * Toda recusa devolve 404, nunca 401 ou 403. Um 403 confirmaria para quem está
 * varrendo a internet que existe algo naquele caminho e que só falta a chave.
 */
function protegerMcp(request: NextRequest) {
  const notFound = () => new NextResponse(null, { status: 404 });

  const expectedSecret = process.env.MCP_SECRET_PATH;
  if (!expectedSecret) {
    console.error("MCP_SECRET_PATH não configurada — endpoint MCP desativado");
    return notFound();
  }

  // /api/mcp/<segredo>  ->  ["", "api", "mcp", "<segredo>"]
  const segment = request.nextUrl.pathname.split("/")[3] ?? "";
  if (!secretsMatch(segment, expectedSecret)) {
    return notFound();
  }

  // Escape hatch para desenvolvimento: o seu IP nunca estará na faixa da
  // Anthropic. Precisa ficar "false" na hospedagem.
  if (process.env.MCP_DISABLE_IP_CHECK === "true") {
    return NextResponse.next();
  }

  const cidrs = (process.env.MCP_ALLOWED_CIDRS ?? "160.79.104.0/21")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  const ip = clientIp(request);
  if (!ip || !cidrs.some((cidr) => ipInCidr(ip, cidr))) {
    // Vale logar: se a Anthropic mudar a faixa de saída, o sintoma vai ser o
    // conector parar de funcionar, e este log é o que aponta a causa.
    console.warn(`MCP recusado para IP ${ip ?? "desconhecido"}`);
    return notFound();
  }

  return NextResponse.next();
}
