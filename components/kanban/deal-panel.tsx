"use client";

import { useEffect, useState } from "react";
import { X, Send, Trash2, Tag, UserRound, StickyNote, Combine, Loader2 } from "lucide-react";
import { AtividadesLead, type AtividadeDoLead } from "@/components/atividades-lead";
import { dataHora } from "@/lib/atividades";
import { useEhAdmin } from "@/components/sessao";
import type { ScoreFactor } from "@/lib/scoring";
import type { Campo } from "@/lib/custom-fields";
import { cn, initials } from "@/lib/utils";
import { corrigirNomeEtiqueta } from "@/lib/etiquetas-nomes";
import { EVENTO_MUDOU, type DetalheMudou } from "@/components/ao-vivo";

type DealDetail = {
  id: string;
  displayName: string;
  score: number;
  scoreSummary: string;
  scoreFactors: ScoreFactor[];
  stage: { name: string; color: string };
  contact: { phone: string | null; profilePicUrl: string | null; waJid: string };
  messages: {
    id: string;
    fromMe: boolean;
    body: string | null;
    type: string;
    timestamp: string;
  }[];
  customValues: Record<string, string | number | null>;
  notes: { id: string; body: string; createdAt: string }[];
  activities: AtividadeDoLead[];
  labelEvents: EventoEtiqueta[];
};

type EventoEtiqueta = {
  id: string;
  labelName: string;
  labelColor: string | null;
  action: "add" | "remove";
  kind: string;
  detail: string | null;
  createdAt: string;
};

/** Lead que pode ser a mesma pessoa (ver /api/deals/[id]/juntar). */
type OpcaoDeJuncao = {
  id: string;
  nome: string;
  telefone: string | null;
  estagio: { name: string; color: string };
};

/**
 * Juntar este card com outro da mesma pessoa. O CRM junta sozinho quando
 * descobre (mensagem nova, foto de perfil); isto é para o que sobrar.
 */
function JuntarComOutro({
  dealId,
  nome,
  onFeito,
  onCancelar,
}: {
  dealId: string;
  nome: string;
  onFeito: (r: { ficou: string; saiu: string }) => void;
  onCancelar: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [opcoes, setOpcoes] = useState<OpcaoDeJuncao[]>([]);
  const [sugestoes, setSugestoes] = useState(true);
  const [escolhido, setEscolhido] = useState<OpcaoDeJuncao | null>(null);
  const [juntando, setJuntando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      void fetch(`/api/deals/${dealId}/juntar?busca=${encodeURIComponent(busca)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { leads: OpcaoDeJuncao[]; sugestoes: boolean } | null) => {
          if (!d) return;
          setOpcoes(d.leads);
          setSugestoes(d.sugestoes);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [dealId, busca]);

  async function juntar() {
    if (!escolhido) return;
    setJuntando(true);
    setErro(null);
    const res = await fetch(`/api/deals/${dealId}/juntar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comDealId: escolhido.id }),
    });
    const d = await res.json().catch(() => ({}));
    setJuntando(false);
    if (!res.ok) {
      setErro(d.error ?? "Não consegui juntar os dois leads.");
      return;
    }
    onFeito(d);
  }

  return (
    <div className="border-b bg-[var(--color-surface-2)] p-4">
      <p className="text-sm font-medium">Juntar com outro lead (a mesma pessoa)</p>

      {escolhido ? (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-xs text-[var(--color-muted)]">
            {nome} e {escolhido.nome} viram um card só: conversas, notas, atividades e o histórico de etiquetas vão
            juntos, e fica o estágio de quem andou por último no funil. Não dá para desfazer.
          </p>
          {erro && <p className="text-xs text-[var(--color-hot)]">{erro}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={() => void juntar()}
              disabled={juntando}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-ink)] px-3 py-1.5 text-sm font-medium text-[var(--color-on-ink)] disabled:opacity-50"
            >
              {juntando ? <Loader2 className="size-4 animate-spin" /> : <Combine className="size-4" />}
              Juntar
            </button>
            <button
              onClick={() => setEscolhido(null)}
              disabled={juntando}
              className="px-1 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
            >
              Escolher outro
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou número"
            className="w-full rounded-xl bg-[var(--color-surface)] px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
          {sugestoes && opcoes.length > 0 && (
            <p className="text-[11px] text-[var(--color-muted)]">Mais prováveis:</p>
          )}
          <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {opcoes.map((o) => (
              <li key={o.id}>
                <button
                  onClick={() => setEscolhido(o)}
                  className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-[var(--color-surface)]"
                >
                  <span className="min-w-0 flex-1 truncate">{o.nome}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-muted)]">{o.telefone ?? "sem número"}</span>
                  <span
                    className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]"
                    style={{ color: o.estagio.color, backgroundColor: `${o.estagio.color}1a` }}
                  >
                    {o.estagio.name}
                  </span>
                </button>
              </li>
            ))}
            {opcoes.length === 0 && (
              <li className="px-2 py-1.5 text-xs text-[var(--color-muted)]">
                {busca ? "Nenhum lead com esse nome ou número." : "Busque pelo nome ou pelo número."}
              </li>
            )}
          </ul>
          <button
            onClick={onCancelar}
            className="self-start px-1 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

/** Notas e histórico de etiquetas numa linha do tempo só, do mais novo ao mais antigo. */
type ItemDaLinha =
  | { tipo: "nota"; id: string; em: string; texto: string }
  | { tipo: "etiqueta"; id: string; em: string; evento: EventoEtiqueta };

function linhaDoTempo(deal: DealDetail): ItemDaLinha[] {
  return [
    ...deal.notes.map((n) => ({ tipo: "nota" as const, id: n.id, em: n.createdAt, texto: n.body })),
    ...deal.labelEvents.map((e) => ({ tipo: "etiqueta" as const, id: e.id, em: e.createdAt, evento: e })),
  ].sort((a, b) => b.em.localeCompare(a.em));
}

export function DealPanel({
  dealId,
  onClose,
  onRemoved,
}: {
  dealId: string;
  onClose: () => void;
  onRemoved?: (id: string) => void;
}) {
  const [deal, setDeal] = useState<DealDetail | null>(null);
  const admin = useEhAdmin();
  const [tab, setTab] = useState<"conversa" | "notas" | "atividades">("conversa");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [campos, setCampos] = useState<Campo[]>([]);
  const [confirmando, setConfirmando] = useState(false);
  const [removendo, setRemovendo] = useState(false);
  const [juntandoCom, setJuntandoCom] = useState(false);

  async function load() {
    const res = await fetch(`/api/deals/${dealId}`);
    if (!res.ok) return;

    const bruto = await res.json();

    // A resposta do fetch entra como `any`: o TypeScript não valida nada aqui.
    // Normalizar as listas evita que um campo ausente derrube a tela inteira
    // com "cannot read properties of undefined".
    setDeal({
      ...bruto,
      messages: bruto.messages ?? [],
      customValues: bruto.customValues ?? {},
      notes: bruto.notes ?? [],
      activities: bruto.activities ?? [],
      labelEvents: bruto.labelEvents ?? [],
      scoreFactors: bruto.scoreFactors ?? [],
    });
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  // Mensagem nova deste lead chegou com o painel aberto: busca de novo, para a
  // conversa aparecer sem fechar e abrir. Avisos sem lista de deals (uma
  // importação) também podem ter trazido mensagens deste contato.
  useEffect(() => {
    const aoMudar = (e: Event) => {
      const { dealIds } = (e as CustomEvent<DetalheMudou>).detail ?? { dealIds: [] };
      if (dealIds.length === 0 || dealIds.includes(dealId)) void load();
    };
    window.addEventListener(EVENTO_MUDOU, aoMudar);
    return () => window.removeEventListener(EVENTO_MUDOU, aoMudar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  useEffect(() => {
    void fetch("/api/custom-fields")
      .then((r) => r.json())
      .then(setCampos)
      .catch(() => {});
  }, []);

  // Esc fecha o painel — é o reflexo de quem usa CRM o dia todo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function addNote() {
    if (!draft.trim()) return;
    setSaving(true);
    await fetch(`/api/deals/${dealId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: draft }),
    });
    setDraft("");
    setSaving(false);
    void load();
  }

  async function definirCampo(campoId: string, valor: string) {
    // Otimista: o controle responde na hora. Esperar o servidor daria sensacao
    // de travamento num campo que deveria ser instantaneo.
    setDeal((d) =>
      d ? { ...d, customValues: { ...d.customValues, [campoId]: valor || null } } : d,
    );

    await fetch(`/api/deals/${dealId}/fields`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campoId, valor: valor || null }),
    });
  }

  async function remover(permanente: boolean) {
    setRemovendo(true);
    const res = await fetch(
      `/api/deals/${dealId}${permanente ? "?permanente=true" : ""}`,
      { method: "DELETE" },
    );
    setRemovendo(false);
    if (res.ok) {
      onRemoved?.(dealId);
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 p-0 backdrop-blur-sm sm:p-3" onClick={onClose}>
      <aside
        className="glass-forte flex h-full w-full max-w-md flex-col overflow-hidden sm:rounded-[32px]"
        onClick={(e) => e.stopPropagation()}
      >
        {!deal ? (
          <div className="grid flex-1 place-items-center text-sm text-[var(--color-muted)]">
            Carregando…
          </div>
        ) : (
          <>
            <header className="flex items-start gap-3 border-b p-5">
              {deal.contact.profilePicUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={deal.contact.profilePicUrl}
                  alt=""
                  className="size-11 rounded-full object-cover"
                />
              ) : (
                <div className="grid size-11 place-items-center rounded-full bg-[var(--color-ink)] text-sm font-semibold text-[var(--color-on-ink)]">
                  {initials(deal.displayName)}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <h2 className="truncate font-semibold">{deal.displayName}</h2>
                <p className="select-all text-xs tabular-nums text-[var(--color-muted)]">
                  {deal.contact.phone ?? (
                    <span
                      className="italic"
                      title="O WhatsApp só informou o código interno desta pessoa. O número aparece quando ela mandar mensagem."
                    >
                      Número ainda não informado pelo WhatsApp
                    </span>
                  )}
                </p>
                <span
                  className="mt-1 inline-block rounded-full px-2 py-0.5 text-[11px]"
                  style={{
                    color: deal.stage.color,
                    backgroundColor: `${deal.stage.color}1a`,
                  }}
                >
                  {deal.stage.name}
                </span>
              </div>

              <div className="flex items-center gap-1">
                {admin && (
                  <button
                    onClick={() => {
                      setConfirmando(false);
                      setJuntandoCom((v) => !v);
                    }}
                    className="rounded-full p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                    aria-label="Juntar com outro lead"
                    title="Juntar com outro lead (a mesma pessoa em dois cards)"
                  >
                    <Combine className="size-4" />
                  </button>
                )}
                <button
                  onClick={() => {
                    setJuntandoCom(false);
                    setConfirmando(true);
                  }}
                  className="rounded-full p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-hot)]"
                  aria-label="Remover do funil"
                  title="Remover do funil"
                >
                  <Trash2 className="size-4" />
                </button>
                <button
                  onClick={onClose}
                  className="rounded-full p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
                  aria-label="Fechar"
                >
                  <X className="size-4" />
                </button>
              </div>
            </header>

            {juntandoCom && (
              <JuntarComOutro
                dealId={dealId}
                nome={deal.displayName}
                onCancelar={() => setJuntandoCom(false)}
                onFeito={({ ficou, saiu }) => {
                  setJuntandoCom(false);
                  // O card que saiu some da tela na hora; se era este, o
                  // painel fecha (o que ficou já está no funil, com tudo).
                  onRemoved?.(saiu);
                  if (saiu === dealId) onClose();
                  else if (ficou === dealId) void load();
                }}
              />
            )}

            {/* Duas opções em vez de um "confirmar": a diferença entre elas não
                é de grau, é de consequência. Arquivar preserva as métricas;
                apagar reescreve o passado do funil. */}
            {confirmando && (
              <div className="border-b bg-[var(--color-surface-2)] p-4">
                <p className="text-sm font-medium">Remover {deal.displayName}?</p>

                <div className="mt-3 flex flex-col gap-2">
                  <button
                    onClick={() => void remover(false)}
                    disabled={removendo}
                    className="rounded-full border px-3 py-2 text-left text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
                  >
                    <span className="font-medium">Arquivar</span>
                    <span className="block text-xs text-[var(--color-muted)]">
                      Some do funil, mas o histórico fica. Suas métricas de
                      conversão continuam corretas.
                    </span>
                  </button>

                  {/* Irreversível: só administradores. */}
                  {admin && (
                    <button
                      onClick={() => void remover(true)}
                      disabled={removendo}
                      className="rounded-full border px-3 py-2 text-left text-sm hover:border-[var(--color-hot)] disabled:opacity-50"
                    >
                      <span className="font-medium text-[var(--color-hot)]">
                        Apagar tudo
                      </span>
                      <span className="block text-xs text-[var(--color-muted)]">
                        Apaga contato, conversas e histórico. As métricas passadas
                        mudam, porque as passagens dele pelo funil deixam de existir.
                        Se ele te mandar mensagem de novo, volta como lead novo.
                      </span>
                    </button>
                  )}

                  <button
                    onClick={() => setConfirmando(false)}
                    disabled={removendo}
                    className="self-start px-1 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* O score aparece decomposto, não como número solto: dá para discordar
                de um fator específico em vez de desconfiar do sistema inteiro. */}
            <div className="border-b px-4 py-3">
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums">{deal.score}</span>
                <span className="text-sm text-[var(--color-muted)]">
                  {deal.scoreSummary}
                </span>
              </div>
              <ul className="space-y-1">
                {deal.scoreFactors.map((f) => (
                  <li key={f.key} className="flex gap-2 text-xs">
                    <span
                      className={cn(
                        "w-8 shrink-0 text-right font-medium tabular-nums",
                        f.points > 0
                          ? "text-[var(--color-accent)]"
                          : f.points < 0
                            ? "text-[var(--color-hot)]"
                            : "text-[var(--color-muted)]",
                      )}
                    >
                      {f.points > 0 ? `+${f.points}` : f.points}
                    </span>
                    <span className="text-[var(--color-muted)]">{f.detail}</span>
                  </li>
                ))}
              </ul>
            </div>

            {campos.length > 0 && (
              <div className="flex flex-col gap-2 border-b px-4 py-3">
                {campos.map((campo) => (
                  <div key={campo.id} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 truncate text-xs text-[var(--color-muted)]">
                      {campo.name}
                    </span>

                    {campo.type === "SELECT" ? (
                      <select
                        value={String(deal.customValues[campo.id] ?? "")}
                        onChange={(e) => void definirCampo(campo.id, e.target.value)}
                        className="min-w-0 flex-1 rounded-xl bg-[var(--color-surface-2)] px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                      >
                        <option value="">—</option>
                        {campo.options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={
                          campo.type === "NUMBER"
                            ? "number"
                            : campo.type === "DATE"
                              ? "date"
                              : "text"
                        }
                        defaultValue={String(deal.customValues[campo.id] ?? "")}
                        // onBlur em vez de onChange: salvar a cada tecla geraria
                        // uma requisicao por caractere.
                        onBlur={(e) => void definirCampo(campo.id, e.target.value)}
                        className="min-w-0 flex-1 rounded-xl bg-[var(--color-surface-2)] px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            <nav className="flex gap-1 border-b p-2">
              {(["conversa", "notas", "atividades"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "flex-1 rounded-full px-3 py-2 text-sm capitalize transition-colors",
                    tab === t
                      ? "bg-[var(--color-ink)] font-medium text-[var(--color-on-ink)]"
                      : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
                  )}
                >
                  {t}
                </button>
              ))}
            </nav>

            <div className="scroll-thin flex-1 overflow-y-auto p-4">
              {tab === "conversa" && (
                <div className="flex flex-col gap-2">
                  {deal.messages.length === 0 && (
                    <p className="text-sm text-[var(--color-muted)]">
                      Nenhuma mensagem importada para este contato.
                    </p>
                  )}
                  {/* A API devolve da mais recente para a mais antiga; a leitura
                      natural é o contrário. */}
                  {[...deal.messages].reverse().map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm",
                        m.fromMe
                          ? "self-end bg-[color-mix(in_srgb,var(--color-accent)_28%,var(--color-surface))]"
                          : "self-start bg-[var(--color-surface-2)]",
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words">
                        {m.body ?? <em className="opacity-60">{m.type}</em>}
                      </p>
                      <p className="mt-1 text-[10px] text-[var(--color-muted)]">
                        {dataHora(m.timestamp)}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {tab === "notas" && (
                <div className="flex flex-col gap-2">
                  {linhaDoTempo(deal).map((item) =>
                    item.tipo === "nota" ? (
                      <div key={item.id} className="rounded-xl bg-[var(--color-surface-2)] p-3 text-sm">
                        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                          <StickyNote className="size-3" /> Anotação
                        </p>
                        <p className="mt-1 whitespace-pre-wrap">{item.texto}</p>
                        <p className="mt-1 text-[10px] text-[var(--color-muted)]">{dataHora(item.em)}</p>
                      </div>
                    ) : (
                      <EventoDeEtiqueta key={item.id} evento={item.evento} />
                    ),
                  )}
                  {deal.notes.length === 0 && deal.labelEvents.length === 0 && (
                    <p className="text-sm text-[var(--color-muted)]">
                      Nenhuma anotação nem etiqueta ainda. As etiquetas que este
                      contato receber no WhatsApp aparecem aqui.
                    </p>
                  )}
                </div>
              )}

              {tab === "atividades" && (
                <AtividadesLead
                  dealId={dealId}
                  atividades={deal.activities}
                  onMudou={() => void load()}
                />
              )}
            </div>

            {tab === "notas" && (
              <div className="flex gap-2 border-t p-3">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addNote()}
                  placeholder="Escreva uma anotação…"
                  className="flex-1 rounded-xl bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-muted)] focus:ring-1 focus:ring-[var(--color-accent)]"
                />
                <button
                  onClick={addNote}
                  disabled={saving || !draft.trim()}
                  className="rounded-full bg-[var(--color-ink)] px-3 text-[var(--color-on-ink)] disabled:opacity-40"
                >
                  <Send className="size-4" />
                </button>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

/**
 * Uma linha do histórico de etiquetas: qual etiqueta, se entrou ou saiu e o
 * que o CRM fez. Etiqueta de atendente vira a frase "Maria atendeu o lead",
 * com a passagem de quem atendeu antes logo abaixo.
 */
function EventoDeEtiqueta({ evento }: { evento: EventoEtiqueta }) {
  const saiu = evento.action === "remove";
  // "vendedor" é o nome antigo do mesmo tipo.
  const atendente = evento.kind === "atendente" || evento.kind === "vendedor";
  const cor = evento.labelColor ?? "var(--color-muted)";

  if (atendente && !saiu) {
    return (
      <div className="flex gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_7%,transparent)] px-3 py-2 text-sm">
        <UserRound className="mt-0.5 size-3.5 shrink-0 text-[var(--color-accent)]" />
        <div className="min-w-0 flex-1">
          <p>
            <span className="font-semibold text-[var(--color-accent)]">{corrigirNomeEtiqueta(evento.labelName)}</span> atendeu o lead
          </p>
          {evento.detail && <p className="text-xs text-[var(--color-muted)]">{evento.detail}</p>}
          <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">{dataHora(evento.createdAt)}</p>
        </div>
      </div>
    );
  }

  return (
    <EventoComum evento={evento} saiu={saiu} atendente={atendente} cor={cor} />
  );
}

function EventoComum({
  evento,
  saiu,
  atendente,
  cor,
}: {
  evento: EventoEtiqueta;
  saiu: boolean;
  atendente: boolean;
  cor: string;
}) {
  const vendedor = atendente;
  return (
    <div className="flex gap-2.5 rounded-xl border border-dashed px-3 py-2 text-sm">
      {vendedor ? (
        <UserRound className="mt-0.5 size-3.5 shrink-0 text-[var(--color-accent)]" />
      ) : (
        <Tag className="mt-0.5 size-3.5 shrink-0" style={{ color: cor }} />
      )}
      <div className="min-w-0 flex-1">
        <p>
          <span className="text-[var(--color-muted)]">
            {saiu ? (vendedor ? "Saiu do atendimento: " : "Removido de: ") : "Adicionado a: "}
          </span>
          <span className={cn("font-medium", saiu && "line-through opacity-70")}>{corrigirNomeEtiqueta(evento.labelName)}</span>
        </p>
        {evento.detail && (
          <p className={cn("text-xs", vendedor ? "font-medium text-[var(--color-accent)]" : "text-[var(--color-muted)]")}>
            {evento.detail}
          </p>
        )}
        <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">{dataHora(evento.createdAt)}</p>
      </div>
    </div>
  );
}
