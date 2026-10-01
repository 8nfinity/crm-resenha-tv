/**
 * Teste da junção de contatos duplicados (telefone × LID) com dados
 * TEMPORÁRIOS no banco — conta, contatos e leads de teste, apagados no fim.
 *
 *   npx tsx --env-file=.env scripts/testar-mescla-lid.ts
 */
import { prisma } from "../lib/db";
import { createDealForContact } from "../lib/deals";
import { acharContato, ingestLiveMessage, upsertContact } from "../lib/ingest";

const SUF = Date.now().toString(36);
const PN = "5599000007701@s.whatsapp.net";
const LID = `9${Date.now()}77@lid`;
const PN2 = "5599000007702@s.whatsapp.net";
const LID2 = `8${Date.now()}88@lid`;
let ok = 0;
let falhas = 0;
const confere = (nome: string, cond: unknown, extra?: unknown) => {
  if (cond) ok++;
  else falhas++;
  console.log(`  ${cond ? "ok" : "FALHOU"}  ${nome}`, cond || extra === undefined ? "" : JSON.stringify(extra));
};

async function main() {
  const conta = await prisma.whatsAppAccount.create({ data: { instanceName: `mescla-${SUF}`, label: "Mescla teste" } });
  try {
    console.log("\nCaso 1: a mesma pessoa já virou dois leads (telefone e LID)");
    const cPn = await upsertContact({ accountId: conta.id, waJid: PN, pushName: "Maria Teste" });
    const dPn = await createDealForContact(cPn.id);
    await prisma.activity.create({ data: { dealId: dPn.id, type: "FOLLOW_UP", title: "Ligar (lead do telefone)" } });
    await prisma.message.create({ data: { contactId: cPn.id, waMessageId: `A-${SUF}`, fromMe: false, type: "TEXT", body: "oi", timestamp: new Date(Date.now() - 60_000) } });

    // Contato antigo só pelo LID (como a versão anterior criava), com lead, nota e mensagens.
    const cLid = await prisma.contact.create({ data: { accountId: conta.id, waJid: LID, pushName: "Maria" } });
    const dLid = await createDealForContact(cLid.id);
    await prisma.note.create({ data: { dealId: dLid.id, body: "Nota no lead do LID" } });
    await prisma.message.createMany({
      data: [
        { contactId: cLid.id, waMessageId: `A-${SUF}`, fromMe: false, type: "TEXT", body: "oi", timestamp: new Date(Date.now() - 60_000) },
        { contactId: cLid.id, waMessageId: `B-${SUF}`, fromMe: false, type: "TEXT", body: "tudo bem?", timestamp: new Date() },
      ],
    });

    // Chega uma mensagem pelo LID trazendo o telefone (como a Evolution manda hoje).
    await ingestLiveMessage(conta.id, {
      key: { id: `C-${SUF}`, remoteJid: LID, remoteJidAlt: PN, fromMe: false },
      pushName: "Maria Teste",
      message: { conversation: "quero agendar" },
      messageTimestamp: Math.floor(Date.now() / 1000),
    });

    const contatos = await prisma.contact.findMany({ where: { accountId: conta.id }, include: { deals: true } });
    confere("sobra um contato só", contatos.length === 1, contatos.map((c) => c.waJid));
    const c = contatos[0];
    confere("o contato que fica é o do telefone, com o LID guardado", c?.waJid === PN && c?.lid === LID && c?.phone === "5599000007701", c);
    confere("um lead só", c?.deals.length === 1);
    const dealId = c?.deals[0]?.id;
    const msgs = await prisma.message.findMany({ where: { contactId: c?.id } });
    confere("mensagens juntas, sem repetir a que existia nos dois (3)", msgs.length === 3, msgs.map((m) => m.waMessageId));
    confere("anotação do lead do LID veio junto", (await prisma.note.count({ where: { dealId } })) === 1);
    confere("atividade do lead do telefone continua", (await prisma.activity.count({ where: { dealId } })) === 1);
    confere("lead duplicado sumiu", (await prisma.deal.count({ where: { id: dLid.id } })) === 0);

    console.log("\nCaso 2: só existia pelo LID; uma mensagem revela o telefone");
    const so = await upsertContact({ accountId: conta.id, waJid: LID2, pushName: "João" });
    const dSo = await createDealForContact(so.id);
    const depois = await upsertContact({ accountId: conta.id, waJid: LID2, alt: PN2 });
    confere("o mesmo contato vira o do telefone (nada se perde)", depois.id === so.id && depois.waJid === PN2 && depois.lid === LID2, depois);
    confere("o lead continua o mesmo", (await prisma.deal.findUnique({ where: { contactId: depois.id } }))?.id === dSo.id);

    console.log("\nCaso 3: mensagem só com o LID depois de conhecido o telefone");
    const r = await upsertContact({ accountId: conta.id, waJid: LID2 });
    confere("acha o contato do telefone pelo LID (não cria outro)", r.id === so.id && (await prisma.contact.count({ where: { accountId: conta.id } })) === 2);
    confere("busca por qualquer identificador acha o mesmo", (await acharContato(conta.id, LID2))?.id === so.id && (await acharContato(conta.id, PN2))?.id === so.id);
  } finally {
    await prisma.whatsAppAccount.delete({ where: { id: conta.id } });
    console.log("\nLimpeza: dados de teste apagados");
  }
  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  await prisma.$disconnect();
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
