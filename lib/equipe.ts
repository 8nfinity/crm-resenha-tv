import { prisma } from "@/lib/db";

/**
 * Confere a pessoa escolhida como responsável. `null` e "" são "ninguém"
 * (válido); `undefined` é "não mexer". Devolve o id a gravar, ou `false` se
 * a pessoa não existe ou foi desativada.
 */
export async function responsavelValido(id: string | null | undefined): Promise<string | null | undefined | false> {
  if (id === undefined) return undefined;
  if (!id) return null;
  const pessoa = await prisma.user.findFirst({ where: { id, active: true }, select: { id: true } });
  return pessoa ? pessoa.id : false;
}
