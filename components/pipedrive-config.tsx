"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Unplug } from "lucide-react";

type Status =
  | { conectado: false }
  | {
      conectado: true;
      empresa: string | null;
      usuario: string | null;
      dominio: string;
      erro: string | null;
      pipelineId: number | null;
      stageId: number | null;
      autoStageId: string | null;
    };

type FunilPipedrive = { id: number; nome: string; etapas: { id: number; nome: string }[] };
type ColunaCrm = { id: string; name: string; pipeline: { id: string; name: string } };

const campo =
  "w-full rounded-md bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-muted)] focus:ring-1 focus:ring-[var(--color-accent)]";

/**
 * Conectar o Pipedrive: colar o token, escolher o funil e a etapa de lá onde
 * os negócios entram e, se quiser, a coluna do CRM que envia sozinha.
 */
export function PipedriveConfig() {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [funis, setFunis] = useState<FunilPipedrive[] | null>(null);
  const [colunas, setColunas] = useState<ColunaCrm[]>([]);
  const [destino, setDestino] = useState<{ pipelineId: number | null; stageId: number | null; autoStageId: string | null }>({
    pipelineId: null,
    stageId: null,
    autoStageId: null,
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function carregar() {
    const res = await fetch("/api/pipedrive").catch(() => null);
    if (!res?.ok) return setStatus({ conectado: false });
    const s: Status = await res.json();
    setStatus(s);
    if (s.conectado) {
      setDestino({ pipelineId: s.pipelineId, stageId: s.stageId, autoStageId: s.autoStageId });
      const f = await fetch("/api/pipedrive/funis").catch(() => null);
      if (f?.ok) setFunis(await f.json());
      else setErro((await f?.json().catch(() => null))?.error ?? "Não deu para ler os funis do Pipedrive.");
    }
  }

  useEffect(() => {
    void carregar();
    void fetch("/api/stages")
      .then((r) => (r.ok ? r.json() : []))
      .then(setColunas)
      .catch(() => {});
  }, []);

  async function conectar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    setOk(null);
    const res = await fetch("/api/pipedrive", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token.trim() }),
    }).catch(() => null);
    setSalvando(false);
    const corpo = await res?.json().catch(() => null);
    if (!res?.ok) return setErro(corpo?.error ?? "Não deu para conectar.");
    setToken("");
    setOk(`Conectado à empresa ${corpo.empresa}. Agora escolha para onde vão os negócios.`);
    await carregar();
  }

  async function salvarDestino(novo: typeof destino) {
    setDestino(novo);
    setErro(null);
    setOk(null);
    const res = await fetch("/api/pipedrive", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(novo),
    }).catch(() => null);
    if (!res?.ok) setErro("Não deu para salvar. Tente de novo.");
    else setOk("Salvo.");
  }

  async function desconectar() {
    await fetch("/api/pipedrive", { method: "DELETE" }).catch(() => null);
    setFunis(null);
    setOk(null);
    await carregar();
  }

  if (!status) return <p className="text-sm text-[var(--color-muted)]">Carregando…</p>;

  if (!status.conectado) {
    return (
      <form onSubmit={conectar} className="flex flex-col gap-2">
        <ol className="list-decimal space-y-1 pl-5 text-xs text-[var(--color-muted)]">
          <li>No Pipedrive, clique na sua foto (canto de cima) → <b>Configurações pessoais</b> → <b>API</b>.</li>
          <li>Copie o <b>token de API pessoal</b> e cole aqui.</li>
        </ol>
        <div className="mt-1 flex gap-2">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Token de API do Pipedrive"
            autoComplete="off"
            className={campo}
          />
          <button
            disabled={salvando || token.trim().length < 10}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm font-semibold text-[var(--color-on-ink)] disabled:opacity-50"
          >
            {salvando && <Loader2 className="size-4 animate-spin" />}
            Conectar
          </button>
        </div>
        <p className="text-[11px] text-[var(--color-muted)]">
          O token fica guardado só no servidor do CRM e nunca aparece de novo na tela. Os negócios são criados em nome do dono do token.
        </p>
        {erro && <p className="text-xs text-[var(--color-hot)]">{erro}</p>}
      </form>
    );
  }

  const funil = funis?.find((f) => f.id === destino.pipelineId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] px-3 py-2 text-sm">
        <CheckCircle2 className="size-4 shrink-0 text-[var(--color-accent)]" />
        <span>
          Conectado{status.empresa ? <> à <b>{status.empresa}</b></> : null}
          {status.usuario ? ` como ${status.usuario}` : ""} ({status.dominio}.pipedrive.com)
        </span>
        <button onClick={() => void desconectar()} className="ml-auto inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-hot)]">
          <Unplug className="size-3.5" /> Desconectar
        </button>
      </div>
      {status.erro && <p className="text-xs text-[var(--color-hot)]">{status.erro}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-[var(--color-muted)]">
          Funil do Pipedrive
          <select
            value={destino.pipelineId ?? ""}
            disabled={!funis}
            onChange={(e) => {
              const pipelineId = e.target.value ? Number(e.target.value) : null;
              const primeira = funis?.find((f) => f.id === pipelineId)?.etapas[0]?.id ?? null;
              void salvarDestino({ ...destino, pipelineId, stageId: primeira });
            }}
            className={`${campo} mt-1 text-[var(--color-text)]`}
          >
            <option value="">{funis ? "O funil padrão do Pipedrive" : "Carregando…"}</option>
            {funis?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--color-muted)]">
          Etapa em que o negócio entra
          <select
            value={destino.stageId ?? ""}
            disabled={!funil}
            onChange={(e) => void salvarDestino({ ...destino, stageId: e.target.value ? Number(e.target.value) : null })}
            className={`${campo} mt-1 text-[var(--color-text)]`}
          >
            <option value="">{funil ? "A primeira etapa" : "Escolha o funil antes"}</option>
            {funil?.etapas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="text-xs text-[var(--color-muted)]">
        Envio automático
        <select
          value={destino.autoStageId ?? ""}
          onChange={(e) => void salvarDestino({ ...destino, autoStageId: e.target.value || null })}
          className={`${campo} mt-1 text-[var(--color-text)]`}
        >
          <option value="">Desligado — só pelo botão “Enviar para o Pipedrive” no lead</option>
          {colunas.map((c) => (
            <option key={c.id} value={c.id}>
              Quando o lead entrar em: {c.pipeline.name} · {c.name}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-[11px]">
          Vale para arrasto, etiqueta do WhatsApp e painel. Cada lead vai uma vez; depois, o botão no lead atualiza o negócio.
        </span>
      </label>

      {erro && <p className="text-xs text-[var(--color-hot)]">{erro}</p>}
      {ok && <p className="text-xs text-[var(--color-accent)]">{ok}</p>}
    </div>
  );
}
