import { NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/auth/usuario";
import { emailConfigurado, remetente } from "@/lib/email";
import { enviarEmailDeTeste, horaDoResumo, minutosAntes } from "@/lib/avisos";

export const runtime = "nodejs";

/** Situação dos avisos por e-mail, para a tela de Configurações. */
export async function GET() {
  const ator = await exigirAdmin();
  if (ator instanceof Response) return ator;

  return NextResponse.json({
    configurado: emailConfigurado(),
    remetente: remetente(),
    minutosAntes: minutosAntes(),
    horaDoResumo: horaDoResumo(),
  });
}

/** Manda um e-mail de teste para quem clicou. */
export async function POST() {
  const ator = await exigirAdmin();
  if (ator instanceof Response) return ator;

  const r = await enviarEmailDeTeste(ator);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 502 });
  return NextResponse.json({ ok: true, para: ator.email });
}
