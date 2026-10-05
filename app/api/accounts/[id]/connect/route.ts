import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { evolution } from "@/lib/evolution/client";
import { urlDoWebhook } from "@/lib/url-publica";
import { registrarEventoDeConexao } from "@/lib/eventos-conexao";

export const runtime = "nodejs";

/** Um host é "local" quando só a própria máquina o alcança. */
function ehLocal(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

/**
 * Gera o QR Code para parear um número nesta conta, e já aponta a instância
 * para o webhook do CRM — configurar isso na mão no painel da Evolution é o
 * passo que todo mundo esquece, e sem ele a conta fica muda.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const conta = await prisma.whatsAppAccount.findUnique({ where: { id } });
  if (!conta) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  try {
    // A instância pode não existir ainda (conta criada com a Evolution fora do
    // ar, ou removida de lá por fora). Criar é idempotente.
    await evolution.createInstance(conta.instanceName);

    const qr = await evolution.connect(conta.instanceName);
    // Linha do tempo: ao parear, o WhatsApp reenvia de uma vez todas as
    // etiquetas que já estão nas conversas — é por este registro que o CRM
    // reconhece esse reenvio (ver lib/labels.ts).
    if (qr.base64 || qr.code || qr.pairingCode) {
      await registrarEventoDeConexao(conta.id, "qr").catch(() => {});
    }

    const secret = process.env.WEBHOOK_SECRET;
    let webhookConfigurado = false;

    if (secret) {
      const url = new URL(urlDoWebhook(request));
      const crmLocal = ehLocal(url.hostname);
      const evolutionLocal = ehLocal(
        new URL(process.env.EVOLUTION_API_URL ?? "http://localhost").hostname,
      );

      // O webhook só funciona se a Evolution alcançar o CRM. Os dois locais:
      // funciona. CRM local com Evolution remota: não funciona, porque a VPS
      // não tem como chegar na sua máquina.
      webhookConfigurado = !crmLocal || evolutionLocal;

      if (webhookConfigurado) {
        await evolution.setWebhook(conta.instanceName, url.toString(), secret);
      }
    }

    return NextResponse.json({ ...qr, webhookConfigurado });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Falha ao gerar o QR Code",
      },
      { status: 502 },
    );
  }
}
