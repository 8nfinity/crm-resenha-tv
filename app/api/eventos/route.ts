import { ouvirMudancas } from "@/lib/eventos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fluxo de eventos (Server-Sent Events) para as telas abertas.
 *
 * SSE e não WebSocket: o aviso só vai do servidor para o navegador, e o
 * EventSource do navegador já reconecta sozinho se a conexão cair.
 */
export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let encerrar = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const enviar = (texto: string) => {
        try {
          controller.enqueue(encoder.encode(texto));
        } catch {
          encerrar(); // a aba fechou no meio do envio
        }
      };

      // O navegador espera `retry` em ms antes de reconectar.
      enviar("retry: 3000\n\n");

      const cancelar = ouvirMudancas((m) => {
        enviar(`event: mudou\ndata: ${JSON.stringify(m)}\n\n`);
      });

      // Comentário periódico: sem tráfego, proxies e o próprio navegador
      // podem dar a conexão por morta.
      const batimento = setInterval(() => enviar(": ping\n\n"), 25_000);

      encerrar = () => {
        clearInterval(batimento);
        cancelar();
        try {
          controller.close();
        } catch {
          // já fechado
        }
      };

      request.signal.addEventListener("abort", () => encerrar());
    },
    cancel() {
      encerrar();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
