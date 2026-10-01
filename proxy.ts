import { NextResponse, type NextRequest } from "next/server";
import { ipInCidr, secretsMatch } from "@/lib/ip";

/**
 * Proteção do endpoint MCP (convenção "proxy" do Next 16, ex-middleware).
 *
 * O conector do claude.ai não usa OAuth aqui, então a porta é trancada por duas
 * coisas: um segmento secreto na URL e a faixa de IP de saída publicada pela
 * Anthropic (160.79.104.0/21). Para um CRM de um usuário só isso é proporcional;
 * para um produto multi-inquilino, não seria — aí o caminho é OAuth 2.1.
 *
 * Toda recusa devolve 404, nunca 401 ou 403. Um 403 confirmaria para quem está
 * varrendo a internet que existe algo naquele caminho e que só falta a chave.
 * O 404 não conta nada.
 */

export const config = {
  matcher: "/api/mcp/:path*",
};

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

export function proxy(request: NextRequest) {
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
  // Anthropic. Precisa ficar "false" na Vercel.
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
