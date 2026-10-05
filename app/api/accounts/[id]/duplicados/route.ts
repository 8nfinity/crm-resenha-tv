import { NextResponse } from "next/server";
import { juntarDuplicados } from "@/lib/duplicados";
import { avisarMudanca } from "@/lib/eventos";

export const runtime = "nodejs";

/**
 * POST — junta os leads duplicados deste número (a mesma pessoa pelo
 * telefone e pelo LID, ou o mesmo celular com e sem o 9). Ver lib/duplicados.ts.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const resultado = await juntarDuplicados(id);
    if (resultado.pelaLid || resultado.peloNove) avisarMudanca({ dealIds: [], motivo: "funil" });
    return NextResponse.json(resultado);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao juntar os duplicados" },
      { status: 500 },
    );
  }
}
