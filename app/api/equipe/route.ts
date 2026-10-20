import { NextResponse } from "next/server";
import { responsaveis } from "@/lib/calendario";
import { usuarioAtual } from "@/lib/auth/usuario";

/**
 * Quem pode ser responsável por um lead ou uma atividade: as pessoas ativas
 * do CRM, só nome e id (a lista completa, com e-mail e papel, fica em
 * /api/usuarios, que é dos administradores). `eu` é quem está pedindo, para
 * o formulário já vir com a pessoa escolhida.
 */
export async function GET() {
  const [pessoas, eu] = await Promise.all([responsaveis(), usuarioAtual().catch(() => null)]);
  return NextResponse.json({ pessoas, eu: eu?.id ?? null });
}
