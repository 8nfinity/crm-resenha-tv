import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Carimbo" do estado dos dados, para a rede de segurança do tempo real.
 *
 * O aviso instantâneo vem por /api/eventos. Este carimbo cobre o que ele não
 * cobre: aviso perdido numa reconexão, servidor reiniciado, dado gravado por
 * outro processo. A tela pergunta de tempos em tempos; se o carimbo mudou,
 * recarrega. Uma consulta só, barata.
 *
 * Aproveita a viagem para dizer quantos números de WhatsApp estão conectados
 * — é o que acende o aviso "WhatsApp desconectado" no topo da tela.
 *
 * As etiquetas entram no carimbo: sem elas, uma etiqueta criada no celular
 * cujo aviso instantâneo se perdeu só aparecia na tela recarregando a página.
 */
export async function GET() {
  const [linha] = await prisma.$queryRaw<{ versao: string; conectados: number; contas: number }[]>`
    SELECT concat_ws('|',
      (SELECT max("createdAt") FROM "Message"),
      (SELECT count(*) FROM "Deal"),
      (SELECT max("updatedAt") FROM "Deal"),
      (SELECT max("updatedAt") FROM "Activity"),
      (SELECT count(*) FROM "Activity"),
      (SELECT count(*) FROM "Stage"),
      (SELECT max("updatedAt") FROM "PlaybookSection"),
      (SELECT count(*) FROM "PlaybookSection"),
      (SELECT string_agg("status", ',' ORDER BY "id") FROM "WhatsAppAccount"),
      (SELECT count(*) FROM "WhatsAppLabel"),
      (SELECT max("updatedAt") FROM "WhatsAppLabel"),
      (SELECT max("createdAt") FROM "LabelEvent")
    ) AS versao,
    (SELECT count(*) FROM "WhatsAppAccount" WHERE "status" = 'open')::int AS conectados,
    (SELECT count(*) FROM "WhatsAppAccount")::int AS contas
  `;
  return NextResponse.json(
    {
      versao: linha?.versao ?? "",
      whatsapp: {
        conectados: linha?.conectados ?? 0,
        contas: linha?.contas ?? 0,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
