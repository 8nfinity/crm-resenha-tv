import { NextResponse } from "next/server";
import { z } from "zod";
import { criarConta, garantirContaPadrao, listarContas } from "@/lib/accounts";

export const runtime = "nodejs";

/** Lista as contas com status sincronizado e contagem de leads. */
export async function GET() {
  try {
    await garantirContaPadrao();
    return NextResponse.json(await listarContas());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não consegui falar com a Evolution API",
      },
      { status: 502 },
    );
  }
}

const criarSchema = z.object({
  label: z.string().trim().max(40).default(""),
});

/** Cria uma conta nova. O pareamento acontece depois, pelo QR Code. */
export async function POST(request: Request) {
  const parsed = criarSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Apelido inválido" }, { status: 400 });
  }

  try {
    const conta = await criarConta(parsed.data.label);
    return NextResponse.json(conta, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não consegui criar a instância na Evolution",
      },
      { status: 502 },
    );
  }
}
