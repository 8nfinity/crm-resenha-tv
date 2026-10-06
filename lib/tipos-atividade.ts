import { z } from "zod";

/** Validação de um tipo de atividade criado por você (nome e cor). */
export const esquemaTipo = z.object({
  name: z.string().trim().min(1, "Dê um nome ao tipo").max(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida")
    .optional(),
});
