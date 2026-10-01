import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Verificação de saúde para a hospedagem.
 *
 * A Railway chama esta rota depois de cada deploy e só troca a versão no ar
 * quando ela responde 200. Testa o banco de verdade: um CRM que sobe mas não
 * alcança o banco (DATABASE_URL errada, Supabase pausado) não deve substituir
 * a versão que está funcionando.
 */
export async function GET() {
  const inicio = Date.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error("tempo esgotado")), 8000)),
    ]);
    return NextResponse.json({ ok: true, bancoMs: Date.now() - inicio });
  } catch (error) {
    return NextResponse.json(
      { ok: false, erro: `banco inacessível: ${(error as Error).message}` },
      { status: 503 },
    );
  }
}
