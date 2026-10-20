"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type Pessoa = { id: string; nome: string };

// Uma busca por página: vários seletores abertos dividem a mesma resposta.
let pedido: Promise<{ pessoas: Pessoa[]; eu: string | null }> | null = null;

function buscarEquipe() {
  pedido ??= fetch("/api/equipe")
    .then((r) => (r.ok ? r.json() : { pessoas: [], eu: null }))
    .catch(() => {
      pedido = null;
      return { pessoas: [], eu: null };
    });
  return pedido;
}

/** Pessoas ativas do CRM e quem está usando agora. */
export function useEquipe(): { pessoas: Pessoa[]; eu: string | null; carregou: boolean } {
  const [estado, setEstado] = useState<{ pessoas: Pessoa[]; eu: string | null; carregou: boolean }>({
    pessoas: [],
    eu: null,
    carregou: false,
  });
  useEffect(() => {
    let vivo = true;
    void buscarEquipe().then((r) => vivo && setEstado({ ...r, carregou: true }));
    return () => {
      vivo = false;
    };
  }, []);
  return estado;
}

/**
 * Escolha de responsável. Vazio = ninguém (ou "quem criou", conforme o
 * `rotuloVazio`). Uma pessoa já escolhida que saiu do CRM continua aparecendo,
 * para não sumir em silêncio do formulário.
 */
export function SeletorDePessoa({
  valor,
  onChange,
  pessoas,
  rotuloVazio = "Ninguém",
  atual,
  className,
}: {
  valor: string;
  onChange: (id: string) => void;
  pessoas: Pessoa[];
  rotuloVazio?: string;
  /** Nome de quem está escolhido hoje, caso não esteja mais na lista. */
  atual?: Pessoa | null;
  className?: string;
}) {
  const lista = atual && !pessoas.some((p) => p.id === atual.id) ? [...pessoas, atual] : pessoas;
  return (
    <select value={valor} onChange={(e) => onChange(e.target.value)} className={cn(className)}>
      <option value="">{rotuloVazio}</option>
      {lista.map((p) => (
        <option key={p.id} value={p.id}>
          {p.nome}
        </option>
      ))}
    </select>
  );
}
