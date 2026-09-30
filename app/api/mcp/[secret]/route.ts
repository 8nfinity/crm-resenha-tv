import { createMcpHandler } from "mcp-handler";
import { TOOLS } from "@/lib/tools";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Servidor MCP — é isto que o claude.ai enxerga como "conector".
 *
 * O segredo está no caminho da URL e a trava de IP está no proxy.ts, que
 * roda antes desta rota. Aqui dentro já se assume que a requisição é legítima.
 *
 * Modo stateless: cada requisição é independente. Funções serverless não
 * mantêm estado entre invocações, então sessão com estado simplesmente não
 * funcionaria na Vercel.
 */
const handler = createMcpHandler(
  (server) => {
    for (const tool of TOOLS) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.schema,
          annotations: {
            readOnlyHint: true,
            openWorldHint: false,
          },
        },
        // O registro é uniforme, mas os handlers têm assinaturas diferentes
        // entre si; o cast mantém isso num ponto só em vez de espalhar.
        (async (args: never) => {
          try {
            const texto = await (tool.handler as (a: unknown) => Promise<string>)(args);
            return { content: [{ type: "text" as const, text: texto }] };
          } catch (error) {
            console.error(`Erro na ferramenta ${tool.name}`, error);
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    "Não consegui consultar o CRM agora. " +
                    (error instanceof Error ? error.message : "Erro desconhecido"),
                },
              ],
              isError: true,
            };
          }
        }) as never,
      );
    }
  },
  {
    serverInfo: { name: "crm-whatsapp", version: "0.1.0" },
    instructions:
      "Ferramentas de leitura sobre um CRM de WhatsApp. O funil tem estágios " +
      "configuráveis e cada lead tem um score de temperatura de 0 a 100 com os " +
      "fatores que o produziram. Ao recomendar quem abordar, cite os fatores do " +
      "score em vez de apenas o número. Métricas de conversão vêm do histórico " +
      "de passagens entre estágios, então contam quem PASSOU por um estágio no " +
      "período, e não quem está parado nele agora.",
  },
);

export { handler as GET, handler as POST, handler as DELETE };
