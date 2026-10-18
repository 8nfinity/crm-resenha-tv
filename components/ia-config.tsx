"use client";

import { useEffect, useState } from "react";
import { Bot, Loader2, RotateCcw, Send } from "lucide-react";
import { cn } from "@/lib/utils";

type Config = {
  ativo: boolean;
  pipelineId: string | null;
  nome: string;
  modelo: string;
  empresa: string;
  qualificacao: string;
  agenda: string;
  regras: string;
  colunaQualificadoId: string | null;
  colunaAgendadoId: string | null;
  agendaDias: string;
  agendaJanelas: string;
  duracaoMin: number;
  antecedenciaMin: number;
};

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
type Funil = { id: string; name: string; stages: { id: string; name: string; isWon: boolean; isLost: boolean }[] };

const campo =
  "w-full rounded-md border bg-[var(--color-surface)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]";

/**
 * Configuração da IA de atendimento: liga, escolhe o funil que ela atende,
 * as instruções (o "playbook" dela) e para onde ela move o lead. Embaixo, o
 * simulador: uma conversa de teste com as instruções atuais, sem WhatsApp.
 */
export function IaConfig() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [modelos, setModelos] = useState<{ id: string; nome: string }[]>([]);
  const [chave, setChave] = useState(true);
  const [funis, setFunis] = useState<Funil[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    void fetch("/api/ia")
      .then((r) => r.json())
      .then((d) => {
        setChave(d.chaveConfigurada);
        setModelos(d.modelos ?? []);
        setCfg({
          ativo: d.ativo,
          pipelineId: d.pipelineId,
          nome: d.nome,
          modelo: d.modelo,
          empresa: d.empresa,
          qualificacao: d.qualificacao,
          agenda: d.agenda,
          regras: d.regras,
          colunaQualificadoId: d.colunaQualificadoId,
          colunaAgendadoId: d.colunaAgendadoId,
          agendaDias: d.agendaDias,
          agendaJanelas: d.agendaJanelas,
          duracaoMin: d.duracaoMin,
          antecedenciaMin: d.antecedenciaMin,
        });
      });
    void fetch("/api/pipelines")
      .then((r) => (r.ok ? r.json() : []))
      .then(setFunis);
  }, []);

  if (!cfg) return <p className="text-sm text-[var(--color-muted)]">Carregando…</p>;
  const set = (p: Partial<Config>) => setCfg({ ...cfg, ...p });
  const funil = funis.find((f) => f.id === cfg.pipelineId);
  const colunas = funil?.stages.filter((s) => !s.isLost) ?? [];

  async function salvar(novo: Config) {
    setSalvando(true);
    setAviso(null);
    const res = await fetch("/api/ia", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(novo),
    }).catch(() => null);
    setSalvando(false);
    const corpo = await res?.json().catch(() => null);
    if (!res?.ok) return setAviso({ ok: false, texto: corpo?.error ?? "Não deu para salvar." });
    setCfg(novo);
    setAviso({ ok: true, texto: novo.ativo ? "Salvo. A IA está atendendo o funil escolhido." : "Salvo. A IA está desligada." });
  }

  return (
    <div className="flex flex-col gap-4">
      {!chave && (
        <p className="rounded-md border border-[var(--color-hot)] bg-[color-mix(in_srgb,var(--color-hot)_10%,transparent)] px-3 py-2 text-xs">
          Falta a chave da Anthropic no servidor (variável <code>ANTHROPIC_API_KEY</code> na Railway). Sem ela a IA não responde.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2.5">
        <Bot className={cn("size-5", cfg.ativo ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]")} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{cfg.ativo ? "IA ligada" : "IA desligada"}</p>
          <p className="text-xs text-[var(--color-muted)]">
            {cfg.ativo
              ? `Responde os leads do funil "${funil?.name ?? "?"}" pelo número conectado.`
              : "Ligue depois de preencher as instruções e testar no simulador."}
          </p>
        </div>
        <button
          onClick={() => void salvar({ ...cfg, ativo: !cfg.ativo })}
          disabled={salvando}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-semibold disabled:opacity-50",
            cfg.ativo ? "border text-[var(--color-muted)] hover:text-[var(--color-hot)]" : "bg-[var(--color-ink)] text-[var(--color-on-ink)]",
          )}
        >
          {cfg.ativo ? "Desligar" : "Ligar"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-[var(--color-muted)]">
          Funil que ela atende
          <select
            value={cfg.pipelineId ?? ""}
            onChange={(e) => set({ pipelineId: e.target.value || null, colunaQualificadoId: null, colunaAgendadoId: null })}
            className={cn(campo, "mt-1 text-[var(--color-text)]")}
          >
            <option value="">Escolha o funil de teste…</option>
            {funis.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--color-muted)]">
          Nome dela na conversa
          <input value={cfg.nome} onChange={(e) => set({ nome: e.target.value })} maxLength={40} className={cn(campo, "mt-1 text-[var(--color-text)]")} />
        </label>
        <label className="text-xs text-[var(--color-muted)]">
          Modelo
          <select value={cfg.modelo} onChange={(e) => set({ modelo: e.target.value })} className={cn(campo, "mt-1 text-[var(--color-text)]")}>
            {modelos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="-mt-2 text-[11px] text-[var(--color-muted)]">
        Ela só responde quem está nesse funil. Para testar, ponha leads nele (arrastando, pela etiqueta, ou deixando o funil de entrada do número em Conexão).
      </p>

      <Texto
        rotulo="Sobre a empresa"
        ajuda="O que vocês fazem, o que vendem, para quem, diferenciais, preços que ela pode falar. É o que ela sabe — o que não estiver aqui, ela não inventa."
        valor={cfg.empresa}
        onChange={(empresa) => set({ empresa })}
        linhas={6}
        exemplo="Ex.: A Resenha TV é um canal de entretenimento. Vendemos publicidade: menções ao vivo, vídeos patrocinados e pacotes mensais para comércios locais…"
      />
      <Texto
        rotulo="Como qualificar"
        ajuda="O que ela precisa descobrir e o que faz um lead estar qualificado."
        valor={cfg.qualificacao}
        onChange={(qualificacao) => set({ qualificacao })}
        linhas={4}
        exemplo="Ex.: Perguntar nome do negócio, segmento, cidade e se já anunciou antes. Qualificado: comércio da região com interesse em anunciar nos próximos 30 dias."
      />
      <Agenda cfg={cfg} set={set} />
      <Texto
        rotulo="Como acontece a reunião"
        ajuda="Videochamada, ligação ou presencial; quem participa; como o link chega."
        valor={cfg.agenda}
        onChange={(agenda) => set({ agenda })}
        linhas={2}
        exemplo="Ex.: Reunião por videochamada com o Nego Jão; o link é enviado pela equipe no dia."
      />
      <Texto
        rotulo="Regras extras (opcional)"
        ajuda="Tom de voz, o que nunca dizer, quando chamar um humano."
        valor={cfg.regras}
        onChange={(regras) => set({ regras })}
        linhas={3}
        exemplo="Ex.: Nunca falar de concorrentes. Se perguntarem de vaga de emprego, passar para humano."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-[var(--color-muted)]">
          Ao qualificar, mover para
          <select
            value={cfg.colunaQualificadoId ?? ""}
            disabled={!funil}
            onChange={(e) => set({ colunaQualificadoId: e.target.value || null })}
            className={cn(campo, "mt-1 text-[var(--color-text)]")}
          >
            <option value="">Não mover</option>
            {colunas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--color-muted)]">
          Ao agendar reunião, mover para
          <select
            value={cfg.colunaAgendadoId ?? ""}
            disabled={!funil}
            onChange={(e) => set({ colunaAgendadoId: e.target.value || null })}
            className={cn(campo, "mt-1 text-[var(--color-text)]")}
          >
            <option value="">Não mover</option>
            {colunas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void salvar(cfg)}
          disabled={salvando}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-ink)] px-4 py-2 text-sm font-semibold text-[var(--color-on-ink)] disabled:opacity-50"
        >
          {salvando && <Loader2 className="size-4 animate-spin" />}
          Salvar instruções
        </button>
        {aviso && <p className={cn("text-xs", aviso.ok ? "text-[var(--color-accent)]" : "text-[var(--color-hot)]")}>{aviso.texto}</p>}
      </div>

      <Simulador nome={cfg.nome} />
    </div>
  );
}

/**
 * Horário de atendimento para reuniões. A IA cruza com o Calendário do CRM:
 * só oferece o que está livre (qualquer atividade marcada ocupa o horário).
 */
function Agenda({ cfg, set }: { cfg: Config; set: (p: Partial<Config>) => void }) {
  const dias = new Set(cfg.agendaDias.split(",").filter(Boolean).map(Number));
  const janelas = cfg.agendaJanelas
    .split(",")
    .filter(Boolean)
    .map((j) => j.split("-") as [string, string]);
  const salvarJanelas = (js: [string, string][]) =>
    set({ agendaJanelas: js.filter(([a, b]) => a && b && a < b).map(([a, b]) => `${a}-${b}`).join(",") });

  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-[var(--color-muted)]">
        <span className="font-semibold text-[var(--color-text)]">Agenda de reuniões</span> — ela consulta o Calendário do CRM e só
        oferece horários livres dentro destes dias e faixas. Qualquer atividade já marcada ocupa o horário.
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {DIAS.map((nome, i) => (
          <button
            key={nome}
            type="button"
            onClick={() => {
              const n = new Set(dias);
              if (n.has(i)) n.delete(i);
              else n.add(i);
              set({ agendaDias: [...n].sort().join(",") });
            }}
            className={cn("rounded-md border px-3 py-1 text-xs font-semibold", dias.has(i) ? "bolha border-transparent text-white" : "text-[var(--color-muted)]")}
          >
            {nome}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {janelas.map(([a, b], i) => (
          <span key={i} className="flex items-center gap-1 text-xs text-[var(--color-muted)]">
            das
            <input
              type="time"
              value={a}
              onChange={(e) => salvarJanelas(janelas.map((j, k) => (k === i ? [e.target.value, j[1]] : j)))}
              className="rounded-md border bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]"
            />
            às
            <input
              type="time"
              value={b}
              onChange={(e) => salvarJanelas(janelas.map((j, k) => (k === i ? [j[0], e.target.value] : j)))}
              className="rounded-md border bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]"
            />
            <button type="button" onClick={() => salvarJanelas(janelas.filter((_, k) => k !== i))} className="px-1 hover:text-[var(--color-hot)]" aria-label="Remover faixa">
              ×
            </button>
          </span>
        ))}
        <button type="button" onClick={() => salvarJanelas([...janelas, ["14:00", "18:00"]])} className="rounded-md border px-2.5 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]">
          + faixa de horário
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <label className="text-xs text-[var(--color-muted)]">
          Duração da reunião
          <select value={cfg.duracaoMin} onChange={(e) => set({ duracaoMin: Number(e.target.value) })} className={cn(campo, "mt-1 w-40 text-[var(--color-text)]")}>
            {[15, 20, 30, 45, 60, 90].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--color-muted)]">
          Antecedência mínima
          <select value={cfg.antecedenciaMin} onChange={(e) => set({ antecedenciaMin: Number(e.target.value) })} className={cn(campo, "mt-1 w-44 text-[var(--color-text)]")}>
            {[
              [60, "1 hora"],
              [120, "2 horas"],
              [240, "4 horas"],
              [1440, "1 dia"],
              [2880, "2 dias"],
            ].map(([m, r]) => (
              <option key={m} value={m}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

function Texto({
  rotulo,
  ajuda,
  valor,
  onChange,
  linhas,
  exemplo,
}: {
  rotulo: string;
  ajuda: string;
  valor: string;
  onChange: (v: string) => void;
  linhas: number;
  exemplo: string;
}) {
  return (
    <label className="block text-xs text-[var(--color-muted)]">
      <span className="font-semibold text-[var(--color-text)]">{rotulo}</span> — {ajuda}
      <textarea
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        rows={linhas}
        placeholder={exemplo}
        className={cn(campo, "mt-1 resize-y leading-relaxed text-[var(--color-text)]")}
      />
    </label>
  );
}

type Fala = { de: "contato" | "ia"; texto: string };

/** Conversa de teste com as instruções SALVAS. Não usa WhatsApp nem mexe no CRM. */
function Simulador({ nome }: { nome: string }) {
  const [conversa, setConversa] = useState<Fala[]>([]);
  const [acoes, setAcoes] = useState<string[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim()) return;
    const nova = [...conversa, { de: "contato" as const, texto: texto.trim() }];
    setConversa(nova);
    setTexto("");
    setPensando(true);
    setErro(null);
    const res = await fetch("/api/ia/simular", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversa: nova }),
    }).catch(() => null);
    setPensando(false);
    const corpo = await res?.json().catch(() => null);
    if (!res?.ok) return setErro(corpo?.error ?? "A IA não respondeu.");
    if (corpo.recusou) return setErro("A IA não quis responder essa mensagem (no WhatsApp, passaria para a equipe).");
    setConversa([...nova, ...(corpo.mensagens as string[]).map((t) => ({ de: "ia" as const, texto: t }))]);
    setAcoes((a) => [
      ...a,
      ...(corpo.acoes as { tipo: string; qualificado?: boolean; resumo?: string; inicio?: string; motivo?: string }[]).map((x) =>
        x.tipo === "qualificacao"
          ? `Qualificou (${x.qualificado ? "qualificado" : "não qualificado"}): ${x.resumo}`
          : x.tipo === "reuniao"
            ? `Agendou reunião para ${new Date(x.inicio!).toLocaleString("pt-BR")}: ${x.resumo}`
            : `Passou para humano: ${x.motivo}`,
      ),
    ]);
  }

  return (
    <div className="mt-2 rounded-md border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <p className="text-sm font-semibold">Simulador</p>
        <button
          onClick={() => {
            setConversa([]);
            setAcoes([]);
            setErro(null);
          }}
          className="inline-flex items-center gap-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          <RotateCcw className="size-3.5" /> Recomeçar
        </button>
      </div>
      <p className="px-3 pt-2 text-[11px] text-[var(--color-muted)]">
        Escreva como se fosse um cliente. Usa as instruções salvas — salve antes de testar uma mudança. Nada vai para o WhatsApp nem para o CRM.
      </p>
      <div className="scroll-thin flex max-h-96 min-h-32 flex-col gap-1.5 overflow-y-auto p-3">
        {conversa.map((f, i) => (
          <p
            key={i}
            className={cn(
              "max-w-[80%] whitespace-pre-wrap rounded-md px-3 py-1.5 text-sm",
              f.de === "contato"
                ? "self-start bg-[var(--color-surface-2)]"
                : "self-end bg-[color-mix(in_srgb,var(--color-accent)_22%,transparent)]",
            )}
          >
            {f.de === "ia" && <span className="mb-0.5 block text-[10px] font-bold text-[var(--color-accent)]">🤖 {nome}</span>}
            {f.texto}
          </p>
        ))}
        {pensando && (
          <p className="inline-flex items-center gap-1.5 self-end text-xs text-[var(--color-muted)]">
            <Loader2 className="size-3.5 animate-spin" /> {nome} está digitando…
          </p>
        )}
        {conversa.length === 0 && !pensando && (
          <p className="m-auto text-xs text-[var(--color-muted)]">Mande a primeira mensagem, ex.: “Oi, quero anunciar com vocês”.</p>
        )}
      </div>
      {acoes.length > 0 && (
        <ul className="space-y-0.5 border-t px-3 py-2 text-[11px] text-[var(--color-muted)]">
          {acoes.map((a, i) => (
            <li key={i}>⚙️ {a}</li>
          ))}
        </ul>
      )}
      {erro && <p className="px-3 pb-2 text-xs text-[var(--color-hot)]">{erro}</p>}
      <form onSubmit={enviar} className="flex gap-2 border-t p-2">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Mensagem do cliente…" className={campo} disabled={pensando} />
        <button disabled={pensando || !texto.trim()} className="grid place-items-center rounded-md bg-[var(--color-ink)] px-3 text-[var(--color-on-ink)] disabled:opacity-50" aria-label="Enviar">
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
