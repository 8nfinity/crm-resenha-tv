"use client";

import { createContext, useContext } from "react";
import type { Papel } from "@/lib/auth/papeis";
import { ehAdministrador } from "@/lib/auth/papeis";

/**
 * Papel de quem está logado, disponível para qualquer componente da tela.
 *
 * Serve só para ESCONDER o que a pessoa não pode usar (botão de excluir
 * coluna para vendedor, por exemplo). A permissão de verdade é conferida no
 * servidor — esconder um botão nunca é a única barreira.
 */
const SessaoContexto = createContext<{ papel: Papel | null }>({ papel: null });

export function SessaoProvider({ papel, children }: { papel: Papel | null; children: React.ReactNode }) {
  return <SessaoContexto.Provider value={{ papel }}>{children}</SessaoContexto.Provider>;
}

/** true para master e administradores. */
export function useEhAdmin(): boolean {
  return ehAdministrador(useContext(SessaoContexto).papel);
}
