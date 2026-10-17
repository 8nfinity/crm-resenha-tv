"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function CopyField({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(value);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // clipboard exige contexto seguro (https ou localhost). Se falhar, o
      // texto continua selecionável na tela.
    }
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <code className="scroll-thin flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-[var(--color-surface-2)] px-3 py-2 text-xs">
        {value}
      </code>
      <button
        onClick={copiar}
        className="shrink-0 rounded-full border p-2 text-[var(--color-muted)] hover:text-[var(--color-text)]"
        aria-label="Copiar"
      >
        {copiado ? (
          <Check className="size-4 text-[var(--color-accent)]" />
        ) : (
          <Copy className="size-4" />
        )}
      </button>
    </div>
  );
}
