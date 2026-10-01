import { NextResponse, type NextRequest } from "next/server";
import { ipInCidr, secretsMatch } from "@/lib/ip";
import { COOKIE_SESSAO } from "@/lib/auth/sessao";
import { usuarioDoToken } from "@/lib/auth/usuario";

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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|fonts/).*)"],
};

/** Abertas sem login: cada uma tem a própria trava (ou é a tela de entrar). */
const ROTAS_ABERTAS = ["/login", "/api/auth/login", "/api/webhooks/evolution", "/api/saude", "/api/cron/recalc"];

function aberta(caminho: string): boolean {
  return ROTAS_ABERTAS.some((r) => caminho === r || caminho.startsWith(`${r}/`));
}

export async function proxy(request: NextRequest) {
  const caminho = request.nextUrl.pathname;

  if (caminho.startsWith("/api/mcp")) return protegerMcp(request);

  if (aberta(caminho)) {
    // Quem já está logado e abre /login vai direto para o CRM.
    if (caminho === "/login" && (await usuarioDoToken(request.cookies.get(COOKIE_SESSAO)?.value))) {
      return NextResponse.redirect(new URL("/hoje", request.url));
    }
    return NextResponse.next();
  }

  const usuario = await usuarioDoToken(request.cookies.get(COOKIE_SESSAO)?.value);
  if (usuario) return NextResponse.next();

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
