import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

// O seed roda fora do Next, então carrega o .env por conta própria e monta o
// adapter na mão. Usa a conexão direta: seed é operação de migration, não de app.
const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

// Estágios iniciais. São só um ponto de partida — dá para renomear, reordenar
// e criar novos pela interface sem tocar em código.
const STAGES = [
  { name: "Novo lead", order: 0, color: "#94a3b8" },
  { name: "Contato feito", order: 1, color: "#38bdf8" },
  { name: "Qualificado", order: 2, color: "#818cf8" },
  { name: "Reunião agendada", order: 3, color: "#c084fc" },
  { name: "Proposta enviada", order: 4, color: "#fbbf24" },
  { name: "Ganho", order: 5, color: "#34d399", isWon: true },
  { name: "Perdido", order: 6, color: "#f87171", isLost: true },
];

async function main() {
  // O mesmo id que a migration dos funis dá ao funil das colunas antigas.
  const funil = await prisma.pipeline.upsert({
    where: { id: "funil_principal" },
    update: {},
    create: { id: "funil_principal", name: "Funil principal", order: 0 },
  });

  for (const stage of STAGES) {
    await prisma.stage.upsert({
      where: { pipelineId_order: { pipelineId: funil.id, order: stage.order } },
      update: {},
      create: { ...stage, pipelineId: funil.id },
    });
  }

  await prisma.systemState.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });

  const count = await prisma.stage.count();
  console.log(`Seed concluído: ${count} estágios no funil.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
