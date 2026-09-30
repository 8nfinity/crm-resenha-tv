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
 */
export async function GET() {
  const [linha] = await prisma.$queryRaw<{ versao: string }[]>`
    SELECT concat_ws('|',
      (SELECT max("createdAt") FROM "Message"),
      (SELECT count(*) FROM "Deal"),
      (SELECT max("updatedAt") FROM "Deal"),
      (SELECT max("updatedAt") FROM "Activity"),
      (SELECT count(*) FROM "Activity"),
      (SELECT count(*) FROM "Stage"),
      (SELECT max("updatedAt") FROM "PlaybookSection"),
      (SELECT count(*) FROM "PlaybookSection")
    ) AS versao
  `;
  return NextResponse.json(
    { versao: linha?.versao ?? "" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
