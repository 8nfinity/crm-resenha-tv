"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

/** Evento de janela para componentes que buscam dados por conta própria. */
export const EVENTO_MUDOU = "crm:mudou";
export type DetalheMudou = { dealIds: string[]; motivo: string };

// Rajadas (uma importação, várias mensagens seguidas) viram uma recarga só —
// curto o bastante para a mensagem nova parecer instantânea.
const ESPERA_MS = 250;
// Ao voltar para a aba, só recarrega se ficou fora por um tempo.
const FORA_DA_ABA_MS = 30_000;
// Rede de segurança: de quanto em quanto tempo conferir o carimbo dos dados.
const CONFERIR_MS = 15_000;

type Carimbo = { versao: string; whatsapp: { conectados: number; contas: number } };

/**
 * Mantém a tela em dia com o WhatsApp.
 *
 * Escuta /api/eventos e, a cada aviso, pede ao Next os dados novos da tela
 * atual (router.refresh): o funil, a agenda e as métricas se atualizam sem
 * perder o que está aberto — filtros, painel do lead, rolagem.
 *
 * Também mostra, no topo, quando nenhum WhatsApp está conectado: é o único
 * caso em que mensagens novas NÃO têm como chegar, e precisa ficar visível.
 */
export function AoVivo() {
  const router = useRouter();
  const [conectado, setConectado] = useState(false);
  const [whatsapp, setWhatsapp] = useState<Carimbo["whatsapp"] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultimaRecarga = useRef(Date.now());

  useEffect(() => {
    // Carimbo do último estado que a tela mostrou (ver /api/eventos/versao).
    let versao: string | null = null;
    const lerVersao = async (): Promise<string | null> => {
      try {
        const r = await fetch("/api/eventos/versao", { cache: "no-store" });
        // Sessão venceu (ou o acesso foi desativado): volta para o login em vez
        // de ficar com uma tela parada que parece funcionar.
        if (r.status === 401) {
          window.location.assign(`/login?de=${encodeURIComponent(location.pathname)}`);
          return null;
        }
        if (!r.ok) return null;
        const c = (await r.json()) as Carimbo;
        setWhatsapp(c.whatsapp);
        return c.versao;
      } catch {
        return null;
      }
    };

    const recarregar = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        ultimaRecarga.current = Date.now();
        router.refresh();
        // Atualiza o carimbo, para a conferência periódica não recarregar
        // de novo por uma mudança que acabou de ser mostrada.
        void lerVersao().then((v) => v && (versao = v));
      }, ESPERA_MS);
    };

    // Conferência periódica: se algo mudou e o aviso instantâneo não chegou
    // (reconexão, servidor reiniciado), a tela se atualiza mesmo assim.
    void lerVersao().then((v) => (versao = v));
    const conferencia = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const atual = await lerVersao();
      if (atual && versao && atual !== versao) {
        versao = atual;
        window.dispatchEvent(
          new CustomEvent<DetalheMudou>(EVENTO_MUDOU, { detail: { dealIds: [], motivo: "conferencia" } }),
        );
        recarregar();
      } else if (atual) {
        versao = atual;
      }
    }, CONFERIR_MS);

    let jaAbriu = false;
    const fonte = new EventSource("/api/eventos");

    fonte.onopen = () => {
      setConectado(true);
      // Reconectou depois de uma queda: pode ter perdido avisos no meio.
      if (jaAbriu) recarregar();
      jaAbriu = true;
    };
    fonte.onerror = () => setConectado(false); // o navegador tenta de novo sozinho

    fonte.addEventListener("mudou", (e) => {
      let detalhe: DetalheMudou = { dealIds: [], motivo: "" };
      try {
        detalhe = JSON.parse((e as MessageEvent).data);
      } catch {
        // aviso sem detalhe ainda vale como "algo mudou"
      }
      window.dispatchEvent(new CustomEvent<DetalheMudou>(EVENTO_MUDOU, { detail: detalhe }));
      recarregar();
    });

    const aoVoltar = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - ultimaRecarga.current > FORA_DA_ABA_MS
      ) {
        recarregar();
      }
    };
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      clearInterval(conferencia);
      fonte.close();
      document.removeEventListener("visibilitychange", aoVoltar);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router]);

  const semWhatsapp = whatsapp !== null && whatsapp.conectados === 0;

  // Uma "ilha" só, no espírito da Dynamic Island: discreta enquanto está tudo
  // bem (ponto verde + "Ao vivo"); quando o WhatsApp cai, ela se expande em
  // vermelho e vira um link para Conexão.
  if (semWhatsapp) {
    return (
      <Link
        href="/conexao"
        title="Mensagens novas não chegam enquanto nenhum número estiver conectado. Conecte em Conexão."
        className="ilha inline-flex shrink-0 items-center gap-2 py-2 pl-2.5 pr-3.5 text-xs font-semibold transition-transform hover:scale-[1.03]"
      >
        <span className="grid size-6 place-items-center rounded-full bg-[var(--color-hot)]/20">
          <WifiOff className="size-3.5 text-[var(--color-hot)]" />
        </span>
        <span className="hidden text-white sm:inline">
          {whatsapp.contas === 0 ? "Nenhum WhatsApp" : "WhatsApp desconectado"}
        </span>
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--color-hot)] opacity-70" />
          <span className="relative inline-flex size-2 rounded-full bg-[var(--color-hot)]" />
        </span>
      </Link>
    );
  }

  return (
    <span
      className="ilha hidden shrink-0 items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white md:inline-flex"
      title={
        conectado
          ? "Conversas novas aparecem sozinhas"
          : "Reconectando — as telas voltam a se atualizar sozinhas em instantes"
      }
    >
      <span className="relative flex size-2">
        {conectado && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--color-accent)] opacity-60" />
        )}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            conectado ? "bg-[var(--color-accent)]" : "bg-[var(--color-warm)]",
          )}
        />
      </span>
      <span className={conectado ? "text-[var(--color-accent)]" : "text-[var(--color-warm)]"}>
        {conectado ? "Ao vivo" : "Reconectando"}
      </span>
    </span>
  );
}
