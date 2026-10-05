"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Loader2, ArrowRight, Tag, Trash2, ShieldCheck, ShieldAlert, Smartphone } from "lucide-react";
import { corrigirNomeEtiqueta, ehFiltroAutomatico, estagioDeMesmoNome } from "@/lib/etiquetas-nomes";
import { descreverEvento } from "@/lib/saude-etiquetas";
import { EVENTO_MUDOU, type DetalheMudou } from "@/components/ao-vivo";
import type { Etiquetagem } from "@/lib/etiquetagens-recebidas";

type Estagio = { id: string; name: string; color: string };

type Etiqueta = {
  id: string;
  labelId: string;
  name: string;
  color: string | null;
  stageId: string | null;
  stage: Estagio | null;
  /** Etiqueta de "ignorar": o contato etiquetado some do CRM. */
  ignoreContact: boolean;
  /** Etiqueta de atendente ("João"): registra no histórico quem atendeu. */
  isSeller: boolean;
};

/** Valores do <select> para ações que não são estágio. */
const IGNORAR = "__ignorar__";
const ATENDENTE = "__atendente__";

type Conta = { id: string; label: string | null; status: string };

/** Resultado da última conferência da chave das etiquetas (null: nunca conferida). */
type Saude = { estado: string | null; detalhe: string | null; verificadoEm: string | null };
type EventoConexao = { kind: string; detail: string | null; createdAt: string };

function horario(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * O que chegou do celular e o que o CRM fez com cada etiquetagem. É o teste
 * na hora: etiquete uma conversa no celular e ela aparece aqui em segundos.
 * Se não aparecer, o aviso nem chegou ao CRM.
 */
function RecebidasDoCelular({ recebidas }: { recebidas: Etiquetagem[] }) {
  return (
    <details className="mt-3 text-[11px]" open={recebidas.length > 0}>
      <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 text-[var(--color-muted)]">
        <Smartphone className="size-3.5" />
        O que chegou do celular {recebidas.length > 0 ? `(${recebidas.length})` : ""}
      </summary>
      {recebidas.length === 0 ? (
        <p className="mt-1.5 text-[var(--color-muted)]">
          Nada desde que o CRM foi publicado pela última vez. Para testar, coloque uma conversa numa lista ou
          etiqueta no celular: ela aparece aqui em poucos segundos, com o que o CRM fez. Se não aparecer, o aviso
          não chegou ao CRM — veja a chave das etiquetas acima.
        </p>
      ) : (
        <ul className="mt-1.5 flex flex-col gap-1">
          {recebidas.map((r, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 tabular-nums text-[var(--color-muted)]">{horario(r.quando)}</span>
              <span className="min-w-0">
                <span className="font-medium">{r.contato}</span>{" "}
                <span className="text-[var(--color-muted)]">{r.acao === "add" ? "→ colocado em" : "→ tirado de"}</span>{" "}
                <span className="font-medium">{corrigirNomeEtiqueta(r.etiqueta)}</span>
                {": "}
                <span className={r.moveu ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"}>{r.resultado}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/**
 * Se a chave que abre as etiquetas está lá. Sem ela a conexão parece normal
 * (mensagens chegam), mas nenhuma etiqueta, lista ou exclusão chega ao CRM —
 * é o que a Evolution sofre ao reiniciar sem volume.
 */
function SaudeDasEtiquetas({ saude, eventos }: { saude: Saude | undefined; eventos: EventoConexao[] }) {
  if (!saude?.estado) return null;
  const ok = saude.estado === "ok";
  const grave = saude.estado === "chave_perdida";

  return (
    <div className="mb-3 flex flex-col gap-1.5">
      {ok ? (
        <p className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
          <ShieldCheck className="size-3.5 text-[var(--color-accent)]" />
          Chave das etiquetas OK{saude.verificadoEm ? ` · conferida em ${horario(saude.verificadoEm)}` : ""}
        </p>
      ) : (
        <div
          className={`flex gap-2 rounded-2xl px-3 py-2 text-xs ${
            grave
              ? "bg-[color-mix(in_srgb,var(--color-hot)_14%,transparent)]"
              : "bg-[color-mix(in_srgb,var(--color-warm)_14%,transparent)]"
          }`}
        >
          <ShieldAlert className={`mt-0.5 size-3.5 shrink-0 ${grave ? "text-[var(--color-hot)]" : "text-[var(--color-warm)]"}`} />
          <p>
            {saude.detalhe ?? "A última conferência das etiquetas falhou."}
            {saude.verificadoEm && (
              <span className="text-[var(--color-muted)]"> (conferido em {horario(saude.verificadoEm)})</span>
            )}
          </p>
        </div>
      )}
      {eventos.length > 0 && (
        <details className="text-[11px] text-[var(--color-muted)]">
          <summary className="cursor-pointer select-none">Linha do tempo da conexão</summary>
          <ul className="mt-1.5 flex flex-col gap-0.5 pl-1">
            {eventos.map((e, i) => (
              <li key={i}>
                <span className="tabular-nums">{horario(e.createdAt)}</span> — {descreverEvento(e.kind)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * Mapeamento etiqueta do WhatsApp Business → estágio do funil.
 *
 * O sentido é único: etiquetar no celular move o card. Mover o card no CRM
 * não aplica etiqueta nenhuma — evita o eco entre os dois lados.
 */
export function LabelMapping({
  contas,
  onMudouIgnorados,
}: {
  contas: Conta[];
  /** Avisa a lista de contatos ignorados para recarregar. */
  onMudouIgnorados?: () => void;
}) {
  const [estagios, setEstagios] = useState<Estagio[]>([]);
  const [porConta, setPorConta] = useState<Record<string, Etiqueta[]>>({});
  const [saudePorConta, setSaudePorConta] = useState<
    Record<string, { saude: Saude; eventos: EventoConexao[]; recebidas: Etiquetagem[] }>
  >({});
  const [sincronizando, setSincronizando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(
    async (sincronizar = false, contaId?: string) => {
      const alvos = contaId ? contas.filter((c) => c.id === contaId) : contas;

      for (const conta of alvos) {
        const url = `/api/accounts/${conta.id}/labels${sincronizar ? "?sincronizar=true" : ""}`;
        try {
          const res = await fetch(url);
          const data = await res.json();
          if (!res.ok) {
            setErro(data.error ?? "Falha ao carregar etiquetas");
            continue;
          }
          if (data.erroSync) setErro(data.erroSync);
          if (data.movidos) {
            setAviso(
              `${data.movidos} ${data.movidos === 1 ? "lead que já estava" : "leads que já estavam"} com uma etiqueta ligada a estágio ` +
                `e não ${data.movidos === 1 ? "tinha andado foi movido" : "tinham andado foram movidos"} no funil.`,
            );
          }
          setPorConta((p) => ({ ...p, [conta.id]: data.etiquetas }));
          setSaudePorConta((p) => ({
            ...p,
            [conta.id]: { saude: data.saude, eventos: data.eventos ?? [], recebidas: data.recebidas ?? [] },
          }));
        } catch {
          setErro("Não consegui falar com o servidor.");
        }
      }
      setCarregado(true);
    },
    [contas],
  );

  useEffect(() => {
    void fetch("/api/stages")
      .then((r) => r.json())
      .then((s: Estagio[]) => setEstagios(s))
      .catch(() => {});
    void carregar(false);
  }, [carregar]);

  // Etiquetagem chegando do celular: o painel "O que chegou do celular" e as
  // listas novas aparecem sem recarregar a página.
  useEffect(() => {
    const aoMudar = (e: Event) => {
      const motivo = (e as CustomEvent<DetalheMudou>).detail?.motivo;
      if (motivo === "etiqueta" || motivo === "conexao" || motivo === "conferencia") void carregar(false);
    };
    window.addEventListener(EVENTO_MUDOU, aoMudar);
    return () => window.removeEventListener(EVENTO_MUDOU, aoMudar);
  }, [carregar]);

  async function mapear(contaId: string, labelId: string, valor: string) {
    const ignorar = valor === IGNORAR;
    const vendedor = valor === ATENDENTE;
    const stageId = ignorar || vendedor || !valor ? null : valor;
    setAviso(null);
    // Otimista: o select responde na hora. Esperar o servidor daria a sensação
    // de travamento num controle que deveria ser instantâneo.
    setPorConta((p) => ({
      ...p,
      [contaId]: (p[contaId] ?? []).map((e) =>
        e.labelId === labelId
          ? { ...e, stageId, ignoreContact: ignorar, isSeller: vendedor, stage: estagios.find((s) => s.id === stageId) ?? null }
          : e,
      ),
    }));

    const res = await fetch(`/api/accounts/${contaId}/labels`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labelId, stageId, ignorar, vendedor }),
    });

    if (!res.ok) {
      setErro("Não consegui salvar o mapeamento.");
      void carregar(false, contaId);
      return;
    }
    if (stageId) {
      const { movidos } = (await res.json()) as { movidos?: number };
      const estagio = estagios.find((s) => s.id === stageId)?.name ?? "o estágio";
      setAviso(
        movidos
          ? `${movidos} ${movidos === 1 ? "lead que já estava" : "leads que já estavam"} com essa etiqueta ${movidos === 1 ? "foi" : "foram"} para ${estagio}. ` +
              "Quem já tinha passado desse estágio no funil ficou onde estava."
          : `Pronto: quem receber essa etiqueta no celular vai para ${estagio}.`,
      );
      return;
    }
    if (vendedor) {
      const { registrados } = (await res.json()) as { registrados?: number };
      setAviso(
        "Pronto: quando você aplicar essa etiqueta numa conversa, o histórico do lead registra que essa pessoa atendeu." +
          (registrados
            ? ` ${registrados} ${registrados === 1 ? "conversa que já tinha" : "conversas que já tinham"} a etiqueta ${registrados === 1 ? "ganhou" : "ganharam"} o registro.`
            : ""),
      );
      return;
    }
    if (ignorar) {
      const { ignorados } = (await res.json()) as { ignorados?: number };
      setAviso(
        ignorados
          ? `${ignorados} ${ignorados === 1 ? "contato que já tinha" : "contatos que já tinham"} essa etiqueta ${ignorados === 1 ? "saiu" : "saíram"} do CRM.`
          : "Pronto: quem receber essa etiqueta no celular sai do CRM.",
      );
      onMudouIgnorados?.();
    }
  }

  /**
   * Etiqueta fantasma: apagada no celular, mas a Evolution continua listando
   * (ela estava sem a chave quando você apagou). Some da tela; se for usada de
   * novo no celular, volta sozinha.
   */
  async function tirar(contaId: string, etiqueta: Etiqueta) {
    const nome = corrigirNomeEtiqueta(etiqueta.name);
    if (!confirm(`“${nome}” não existe mais no seu WhatsApp? Ela sai desta lista e deixa de mover leads.`)) return;
    setAviso(null);
    setPorConta((p) => ({ ...p, [contaId]: (p[contaId] ?? []).filter((e) => e.labelId !== etiqueta.labelId) }));
    const res = await fetch(`/api/accounts/${contaId}/labels?labelId=${encodeURIComponent(etiqueta.labelId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setErro("Não consegui tirar a etiqueta.");
      void carregar(false, contaId);
    }
  }

  /** Estágio de mesmo nome, para etiqueta que ainda não faz nada. */
  function sugestaoDe(etiqueta: Etiqueta): Estagio | null {
    if (etiqueta.stageId || etiqueta.ignoreContact || etiqueta.isSeller) return null;
    return estagioDeMesmoNome(etiqueta.name, estagios);
  }

  async function sincronizar(contaId: string) {
    setSincronizando(contaId);
    setErro(null);
    setAviso(null);
    await carregar(true, contaId);
    setSincronizando(null);
  }

  if (!carregado) {
    return <p className="text-sm text-[var(--color-muted)]">Carregando etiquetas…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {aviso && (
        <p className="rounded-2xl bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] px-3 py-2 text-xs">
          {aviso}
        </p>
      )}
      {erro && (
        <p className="rounded-2xl bg-[color-mix(in_srgb,var(--color-hot)_12%,transparent)] px-3 py-2 text-xs">
          {erro}
        </p>
      )}

      {contas.map((conta) => {
        // Listas automáticas (Não lidas, Grupos, Comunidades) não recebem
        // conversas: ficam fora do mapeamento, só citadas no rodapé.
        const todas = porConta[conta.id] ?? [];
        const etiquetas = todas.filter((e) => !ehFiltroAutomatico(e.name));
        const filtros = todas.filter((e) => ehFiltroAutomatico(e.name));
        const conectado = conta.status === "open";
        const semAcao = etiquetas.filter((e) => !e.stageId && !e.ignoreContact && !e.isSeller).length;

        return (
          <div key={conta.id} className="rounded-2xl border p-3">
            <div className="mb-3 flex items-center gap-2">
              <p className="flex-1 text-sm font-medium">
                {conta.label ?? "Conta"}
              </p>
              <button
                onClick={() => void sincronizar(conta.id)}
                disabled={!conectado || sincronizando === conta.id}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
              >
                {sincronizando === conta.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Buscar do aparelho
              </button>
            </div>

            <SaudeDasEtiquetas
              saude={saudePorConta[conta.id]?.saude}
              eventos={saudePorConta[conta.id]?.eventos ?? []}
            />

            {etiquetas.length === 0 ? (
              <p className="text-xs text-[var(--color-muted)]">
                {conectado
                  ? "Nenhuma etiqueta ou lista encontrada. Crie etiquetas (WhatsApp Business) ou listas " +
                    "(aba Conversas → Listas, no WhatsApp) no celular e clique em “Buscar do aparelho”."
                  : "Conecte este número para buscar as etiquetas."}
              </p>
            ) : (
              <>
              {semAcao > 0 && (
                <p className="mb-2 rounded-2xl bg-[color-mix(in_srgb,var(--color-warm)_14%,transparent)] px-3 py-2 text-xs">
                  {semAcao === 1
                    ? "1 etiqueta/lista ainda não move ninguém"
                    : `${semAcao} etiquetas/listas ainda não movem ninguém`}{" "}
                  (“Não move o lead”). Escolha o estágio de cada uma: na hora, todos os leads que já estão com ela
                  entram no funil — sem limite — e os próximos que você etiquetar também.
                </p>
              )}
              <ul className="flex flex-col gap-2">
                {etiquetas.map((etiqueta) => (
                  <li key={etiqueta.id} className="flex items-center gap-2">
                    <Tag
                      className="size-3.5 shrink-0"
                      style={{ color: etiqueta.color ?? "var(--color-muted)" }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {corrigirNomeEtiqueta(etiqueta.name)}
                    </span>

                    <ArrowRight className="size-3.5 shrink-0 text-[var(--color-muted)]" />

                    <div className="flex shrink-0 flex-col gap-1.5">
                      <select
                        value={
                          etiqueta.ignoreContact
                            ? IGNORAR
                            : etiqueta.isSeller
                              ? ATENDENTE
                              : (etiqueta.stageId ?? "")
                        }
                        onChange={(e) => void mapear(conta.id, etiqueta.labelId, e.target.value)}
                        className="w-60 rounded-xl bg-[var(--color-surface-2)] px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                      >
                        <option value="">Não move o lead</option>
                        <option value={IGNORAR}>🚫 Ignorar contato (some do CRM)</option>
                        <option value={ATENDENTE}>👤 Atendente (registra quem atendeu)</option>
                        {estagios.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      {sugestaoDe(etiqueta) && (
                        // Lista com o nome de um estágio, mas ainda sem ação:
                        // é quase sempre o motivo de "pus na lista e não moveu".
                        <button
                          onClick={() => void mapear(conta.id, etiqueta.labelId, sugestaoDe(etiqueta)!.id)}
                          className="self-start rounded-full bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] px-2 py-0.5 text-[11px] font-medium"
                        >
                          Mover para “{sugestaoDe(etiqueta)!.name}”
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => void tirar(conta.id, etiqueta)}
                      title="Não existe mais no celular — tirar do CRM"
                      aria-label={`Tirar ${corrigirNomeEtiqueta(etiqueta.name)} do CRM`}
                      className="shrink-0 rounded-full p-1 text-[var(--color-muted)] hover:text-[var(--color-hot)]"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              </>
            )}
            {filtros.length > 0 && (
              <p className="mt-3 text-[11px] text-[var(--color-muted)]">
                Listas automáticas do WhatsApp, fora do mapeamento (é o próprio WhatsApp que decide quem entra nelas):{" "}
                {filtros.map((f) => corrigirNomeEtiqueta(f.name)).join(", ")}.
              </p>
            )}
            <RecebidasDoCelular recebidas={saudePorConta[conta.id]?.recebidas ?? []} />
          </div>
        );
      })}
    </div>
  );
}
