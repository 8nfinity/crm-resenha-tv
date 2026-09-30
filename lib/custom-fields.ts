import { prisma } from "@/lib/db";

/**
 * Campos definidos por você nos leads.
 *
 * A definição fica em `CustomField` e o valor em `Deal.customValues`, indexado
 * pelo id do campo — não pelo nome. Isso é o que permite renomear "Origem"
 * para "Canal de origem" sem perder o que já estava preenchido.
 */

export type CampoTipo = "TEXT" | "SELECT" | "NUMBER" | "DATE";

export type Campo = {
  id: string;
  name: string;
  type: CampoTipo;
  options: string[];
  order: number;
  showOnCard: boolean;
};

export type ValoresCampos = Record<string, string | number | null>;

/** As opções vêm como JSON solto do banco; normaliza para array de strings. */
function normalizarOpcoes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((o): o is string => typeof o === "string" && o.trim().length > 0);
}

export async function listarCampos(): Promise<Campo[]> {
  const campos = await prisma.customField.findMany({ orderBy: { order: "asc" } });
  return campos.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type as CampoTipo,
    options: normalizarOpcoes(c.options),
    order: c.order,
    showOnCard: c.showOnCard,
  }));
}

/** Lê os valores de um deal, descartando o que não corresponde a campo vivo. */
export function lerValores(raw: unknown, campos: Campo[]): ValoresCampos {
  if (!raw || typeof raw !== "object") return {};

  const bruto = raw as Record<string, unknown>;
  const validos = new Set(campos.map((c) => c.id));
  const saida: ValoresCampos = {};

  for (const [id, valor] of Object.entries(bruto)) {
    // Campo apagado deixa valores órfãos no JSON. Ignorar aqui evita que eles
    // apareçam na tela como coluna sem nome.
    if (!validos.has(id)) continue;
    if (valor === null || typeof valor === "string" || typeof valor === "number") {
      saida[id] = valor;
    }
  }

  return saida;
}

/**
 * Valida e converte um valor para o tipo do campo.
 * Devolve `undefined` quando o valor é inválido — o chamador decide se recusa.
 */
export function converterValor(
  campo: Campo,
  valor: unknown,
): string | number | null | undefined {
  if (valor === null || valor === "") return null;

  switch (campo.type) {
    case "NUMBER": {
      const n = typeof valor === "number" ? valor : Number(valor);
      return Number.isFinite(n) ? n : undefined;
    }
    case "SELECT": {
      const s = String(valor);
      // Só aceita opção da lista: um valor livre num campo de seleção
      // quebraria os filtros e os agrupamentos depois.
      return campo.options.includes(s) ? s : undefined;
    }
    case "DATE": {
      const d = new Date(String(valor));
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
    }
    default:
      return String(valor).slice(0, 500);
  }
}

/** Grava um valor, preservando os demais campos do mesmo lead. */
export async function definirValor(dealId: string, campoId: string, valor: unknown) {
  const campos = await listarCampos();
  const campo = campos.find((c) => c.id === campoId);
  if (!campo) return { erro: "Campo não existe" as const };

  const convertido = converterValor(campo, valor);
  if (convertido === undefined) {
    return { erro: "Valor inválido para este campo" as const };
  }

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { customValues: true },
  });
  if (!deal) return { erro: "Lead não encontrado" as const };

  const atuais = lerValores(deal.customValues, campos);
  const novos = { ...atuais, [campoId]: convertido };

  await prisma.deal.update({
    where: { id: dealId },
    data: { customValues: novos },
  });

  return { ok: true as const, valores: novos };
}
