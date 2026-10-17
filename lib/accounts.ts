import { prisma } from "@/lib/db";
import { evolution, instanciaPadrao } from "@/lib/evolution/client";

/**
 * Contas de WhatsApp conectadas ao CRM.
 *
 * Cada conta é uma instância própria na Evolution API. O CRM guarda o espelho
 * dela (apelido, cor, último status conhecido) e sincroniza sob demanda — o
 * estado real é sempre o da Evolution, porque o celular pode desconectar sem
 * avisar ninguém.
 */

/** Cores atribuídas em ordem, para distinguir as contas no funil. */
const CORES = [
  "#25d366", // verde WhatsApp
  "#38bdf8",
  "#c084fc",
  "#fbbf24",
  "#f87171",
  "#34d399",
];

/**
 * Garante que existe pelo menos uma conta. Chamado na abertura da tela de
 * conexão: sem isso, uma instalação nova mostraria uma lista vazia sem pista
 * do que fazer.
 */
export async function garantirContaPadrao() {
  const total = await prisma.whatsAppAccount.count();
  if (total > 0) return;

  const instanceName = instanciaPadrao();
  await prisma.whatsAppAccount.create({
    data: { instanceName, label: "Principal", color: CORES[0] },
  });
  await evolution.createInstance(instanceName).catch(() => {
    // Se a Evolution estiver fora do ar, a conta fica registrada mesmo assim e
    // a instância é criada na primeira tentativa de conexão.
  });
}

/** Cria uma conta nova, com instância correspondente na Evolution. */
export async function criarConta(label: string) {
  const usadas = await prisma.whatsAppAccount.count();

  // O nome da instância é derivado e estável. Não uso o apelido porque ele
  // pode ser renomeado, e renomear instância na Evolution significa perder a
  // sessão — o celular teria que ser pareado de novo.
  const instanceName = `crm_${Date.now().toString(36)}`;

  await evolution.createInstance(instanceName);

  return prisma.whatsAppAccount.create({
    data: {
      instanceName,
      label: label.trim() || `Conta ${usadas + 1}`,
      color: CORES[usadas % CORES.length],
    },
  });
}

/**
 * Sincroniza o status de todas as contas com a Evolution.
 *
 * Uma consulta por conta. São poucas, e o dado precisa ser fresco: um celular
 * que caiu não avisa o CRM, e mostrar "conectado" para uma sessão morta faria
 * você esperar por mensagens que nunca vão chegar.
 */
export async function sincronizarStatus() {
  const contas = await prisma.whatsAppAccount.findMany({
    orderBy: { createdAt: "asc" },
  });

  const resultados = await Promise.all(
    contas.map(async (conta) => {
      try {
        const status = await evolution.connectionState(conta.instanceName);
        if (status !== conta.status) {
          await prisma.whatsAppAccount.update({
            where: { id: conta.id },
            data: { status },
          });
        }
        return { ...conta, status };
      } catch {
        return { ...conta, status: "erro" };
      }
    }),
  );

  return resultados;
}

/**
 * Desconecta o celular de uma conta.
 *
 * `apagarDados` decide o destino do que já foi importado:
 *   false — os leads ficam no funil, só a linha é desligada. Você pode
 *     reconectar o mesmo número depois e continuar de onde parou.
 *   true  — apaga contatos, conversas e leads daquela conta. O cascade do
 *     schema faz a limpeza; as outras contas não são tocadas.
 */
export async function desconectarConta(
  accountId: string,
  opcoes: { apagarDados: boolean; removerConta: boolean },
) {
  const conta = await prisma.whatsAppAccount.findUnique({ where: { id: accountId } });
  if (!conta) return null;

  // Desconectar na Evolution não pode impedir a limpeza no CRM: se a instância
  // já sumiu de lá, insistir deixaria a conta presa num estado inconsistente.
  if (opcoes.removerConta) {
    await evolution.deleteInstance(conta.instanceName).catch(() => {});
  } else {
    await evolution.logout(conta.instanceName).catch(() => {});
  }

  if (opcoes.removerConta) {
    // O cascade leva contatos, deals, mensagens e histórico desta conta.
    await prisma.whatsAppAccount.delete({ where: { id: accountId } });
    return { modo: "removida" as const };
  }

  if (opcoes.apagarDados) {
    await prisma.contact.deleteMany({ where: { accountId } });
  }

  await prisma.whatsAppAccount.update({
    where: { id: accountId },
    data: { status: "close", phone: null },
  });

  return { modo: opcoes.apagarDados ? ("limpa" as const) : ("desconectada" as const) };
}

/** Resumo de cada conta para a interface: status, leads e contatos. */
export async function listarContas() {
  // Quatro idas ao banco viram uma rodada. A contagem de leads sai de um SQL
  // só, em vez de buscar os deals e depois os contatos deles — que era uma ida
  // a mais e ainda trazia a lista inteira para contar no JavaScript.
  const [contas, contagens, leads] = await Promise.all([
    sincronizarStatus(),
    prisma.contact.groupBy({ by: ["accountId"], _count: { _all: true } }),
    prisma.$queryRaw<{ accountId: string; total: bigint }[]>`
      SELECT c."accountId", COUNT(*)::bigint AS total
      FROM "Deal" d
      JOIN "Contact" c ON c.id = d."contactId"
      WHERE d."archivedAt" IS NULL
      GROUP BY c."accountId"
    `,
  ]);

  const contatosPorConta = new Map(contagens.map((c) => [c.accountId, c._count._all]));
  const leadsPorConta = new Map(leads.map((l) => [l.accountId, Number(l.total)]));

  return contas.map((conta) => ({
    id: conta.id,
    instanceName: conta.instanceName,
    label: conta.label,
    phone: conta.phone,
    status: conta.status,
    color: conta.color,
    entryPipelineId: conta.entryPipelineId,
    contatos: contatosPorConta.get(conta.id) ?? 0,
    leads: leadsPorConta.get(conta.id) ?? 0,
    lastImportAt: conta.lastImportAt?.toISOString() ?? null,
  }));
}

export type ContaResumo = Awaited<ReturnType<typeof listarContas>>[number];
