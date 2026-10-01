import { NextResponse } from "next/server";
import { usuarioAtual } from "@/lib/auth/usuario";
import { enviarPush } from "@/lib/push";

export const runtime = "nodejs";

/** Manda uma notificação de teste para os aparelhos de quem clicou. */
export async function POST() {
  const usuario = await usuarioAtual();
  if (!usuario) return NextResponse.json({ error: "Faça login." }, { status: 401 });

  const aparelhos = await enviarPush([usuario.id], {
    titulo: "Notificações ligadas ✅",
    corpo: "É assim que os lembretes das suas atividades vão chegar neste aparelho.",
    url: "/hoje",
    tag: "teste",
  });
  if (aparelhos === 0) {
    return NextResponse.json(
      { error: "Nenhum aparelho recebeu. Ative as notificações neste aparelho e tente de novo." },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, aparelhos });
}
