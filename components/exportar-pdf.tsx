"use client";

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import type { DadosRelatorio } from "@/lib/relatorio-pdf";

/**
 * Botão de exportar as métricas em PDF.
 *
 * O gerador (e o jsPDF, e as fontes) só carrega no clique: quem nunca exporta
 * não paga esse peso ao abrir a tela de métricas.
 */
export function ExportarPdf(props: DadosRelatorio) {
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState(false);

  async function exportar() {
    setGerando(true);
    setErro(false);
    try {
      const { gerarRelatorioPdf } = await import("@/lib/relatorio-pdf");
      await gerarRelatorioPdf(props);
    } catch (e) {
      console.error("Falha ao gerar o PDF", e);
      setErro(true);
    } finally {
      setGerando(false);
    }
  }

  return (
    <button
      onClick={() => void exportar()}
      disabled={gerando}
      title={erro ? "Não deu para gerar o PDF. Tente de novo." : undefined}
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)] disabled:opacity-50"
    >
      {gerando ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <FileDown className="size-3.5" />
      )}
      {gerando ? "Gerando…" : erro ? "Tentar de novo" : "Exportar PDF"}
    </button>
  );
}
