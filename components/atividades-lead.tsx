"use client";

import { useState } from "react";
import { CalendarPlus, Check, CheckCheck, Pencil, Trash2 } from "lucide-react";
import { EditarAtividade } from "@/components/editar-atividade";
import {
  dataHora,
  diaSemanaHora,
  juntarDataHora,
  numerarFollowUps,
  chaveDoTipo,
  ordinalFollowUp,
  rotuloDaChave,
  situacao,
  sugestaoDePrazo,
  tipoDaChave,
  type TipoProprio,
} from "@/lib/atividades";
import { SeletorDeTipo, useTiposProprios } from "@/components/tipos-atividade";
import { SeletorDePessoa, useEquipe } from "@/components/equipe";
import { cn } from "@/lib/utils";

export type AtividadeDoLead = {
  id: string;
  type: string;
  /** Tipo criado por você, quando tem. */
  kindId?: string | null;
  title: string | null;
  notes?: string | null;
  dueAt: string | null;
  doneAt: string | null;
  createdAt: string;
  createdBy?: { id: string; name: string } | null;
  /** Quem vai fazer; sem ninguém atribuído, vale quem criou. */
  assignedTo?: { id: string; name: string } | null;
};

/** Quem vai fazer a atividade: a pessoa atribuída ou, sem ela, quem criou. */
function responsavelDa(a: AtividadeDoLead): { id: string; nome: string } | null {
  const p = a.assignedTo ?? a.createdBy;
  return p ? { id: p.id, nome: p.name } : null;
}

/**
 * Aba de atividades do painel do lead.
 *
 * Dois caminhos, porque são duas situações reais: AGENDAR o que vai fazer
 * ("ligar amanhã às 9h") e REGISTRAR o que já fez ("liguei agora"). Tudo que
 * aparece carrega data e hora — de quando foi marcado e de quando foi feito.
 */
export function AtividadesLead({
  dealId,
  donoDoLead = null,
  atividades,
  onMudou,
}: {
  dealId: string;
  /** Responsável pelo lead: as atividades novas vão para ele de saída. */
  donoDoLead?: string | null;
  atividades: AtividadeDoLead[];
  onMudou: () => void;
}) {
  const sugestao = sugestaoDePrazo();
  const [tipo, setTipo] = useState<string>("FOLLOW_UP");
  const { proprios, recarregar } = useTiposProprios();
  const [titulo, setTitulo] = useState("");
  const [data, setData] = useState(sugestao.data);
  const [horaStr, setHoraStr] = useState(sugestao.hora);
  const equipe = useEquipe();
  // De saída: o responsável pelo lead; sem ele, quem está marcando.
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const responsavel = escolhido ?? donoDoLead ?? equipe.eu ?? "";
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar(jaFeita: boolean) {
    const dueAt = jaFeita ? null : juntarDataHora(data, horaStr);
    if (!jaFeita && !dueAt) {
      setErro("Escolha a data do compromisso.");
      return;
    }
    setSalvando(true);
    setErro(null);
    const res = await fetch(`/api/deals/${dealId}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(() => {
          const { type, kindId } = tipoDaChave(tipo);
          return kindId ? { type, kindId } : { type };
        })(),
        title: titulo.trim() || undefined,
        assignedToId: responsavel || null,
        ...(jaFeita ? { doneAt: new Date().toISOString() } : { dueAt }),
      }),
    }).catch(() => null);
    setSalvando(false);
    if (!res?.ok) {
      setErro("Não deu para salvar. Tente de novo.");
      return;
    }
    setTitulo("");
    onMudou();
  }

  async function alterar(id: string, corpo: Record<string, unknown>) {
    await fetch(`/api/activities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    onMudou();
  }

  async function apagar(id: string) {
    await fetch(`/api/activities/${id}`, { method: "DELETE" });
    onMudou();
  }

  // 1º, 2º, 3º follow-up deste lead.
  const numeros = numerarFollowUps(atividades);
  // Qual será o número do follow-up que está sendo marcado agora (pela data
  // escolhida: um follow-up marcado antes de outro entra na frente dele).
  const proximoNumero =
    tipo === "FOLLOW_UP"
      ? numerarFollowUps([
          ...atividades,
          {
            id: "__novo__",
            type: "FOLLOW_UP",
            dueAt: juntarDataHora(data, horaStr),
            doneAt: null,
            createdAt: new Date().toISOString(),
          },
        ]).get("__novo__") ?? null
      : null;

  // A fazer: a mais urgente primeiro (sem data vai para o fim).
  const aFazer = atividades
    .filter((a) => !a.doneAt)
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
  // Feitas: a mais recente primeiro.
  const feitas = atividades
    .filter((a) => a.doneAt)
    .sort((a, b) => b.doneAt!.localeCompare(a.doneAt!));

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
        <SeletorDeTipo valor={tipo} onChange={setTipo} proprios={proprios} onMudouTipos={recarregar} />

        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="O que fazer? (ex.: mandar proposta da avaliação 2)"
          className="mt-3 w-full rounded-md bg-[var(--color-surface)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-muted)] focus:ring-1 focus:ring-[var(--color-accent)]"
        />

        <div className="mt-2 flex gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
              Data
            </span>
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              className="w-full rounded-md bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </label>
          <label className="w-28">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
              Hora
            </span>
            <input
              type="time"
              value={horaStr}
              onChange={(e) => setHoraStr(e.target.value)}
              className="w-full rounded-md bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </label>
        </div>

        <label className="mt-2 block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Responsável</span>
          <SeletorDePessoa
            valor={responsavel}
            onChange={setEscolhido}
            pessoas={equipe.pessoas}
            rotuloVazio="Eu (quem está marcando)"
            className="w-full rounded-md bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
        </label>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => void criar(false)}
            disabled={salvando}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[var(--color-ink)] px-3 py-2 text-sm font-semibold text-[var(--color-on-ink)] disabled:opacity-50"
          >
            <CalendarPlus className="size-4" />
            Agendar
          </button>
          <button
            onClick={() => void criar(true)}
            disabled={salvando}
            title="Registra como feita agora, com a data e a hora de agora"
            className="inline-flex items-center justify-center gap-1.5 rounded-full border px-3 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
          >
            <CheckCheck className="size-4" />
            Já fiz agora
          </button>
        </div>
        {proximoNumero && (
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Este será o <span className="font-bold text-[var(--color-accent)]">{ordinalFollowUp(proximoNumero)}</span> deste lead.
          </p>
        )}
        {erro && <p className="mt-2 text-xs text-[var(--color-hot)]">{erro}</p>}
      </section>

      <Lista titulo="A fazer" vazio="Nada agendado para este lead.">
        {aFazer.map((a) => (
          <Item key={a.id} a={a} proprios={proprios} numero={numeros.get(a.id)} onAlternar={() => void alterar(a.id, { feita: true })} onApagar={() => void apagar(a.id)} onEditado={onMudou} />
        ))}
      </Lista>

      {feitas.length > 0 && (
        <Lista titulo="Feitas">
          {feitas.map((a) => (
            <Item key={a.id} a={a} proprios={proprios} numero={numeros.get(a.id)} onAlternar={() => void alterar(a.id, { feita: false })} onApagar={() => void apagar(a.id)} onEditado={onMudou} />
          ))}
        </Lista>
      )}
    </div>
  );
}

function Lista({
  titulo,
  vazio,
  children,
}: {
  titulo: string;
  vazio?: string;
  children: React.ReactNode[];
}) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-[var(--color-muted)]">
        {titulo} {children.length > 0 && <span className="tabular-nums">· {children.length}</span>}
      </h3>
      {children.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">{vazio}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">{children}</ul>
      )}
    </section>
  );
}

const ROTULO_SITUACAO = {
  atrasada: "Atrasada",
  hoje: "Hoje",
  agendada: "Agendada",
  "sem-data": "Sem data",
  feita: "Feita",
} as const;

function Item({
  a,
  proprios,
  numero,
  onAlternar,
  onApagar,
  onEditado,
}: {
  a: AtividadeDoLead;
  proprios: TipoProprio[];
  /** Número do follow-up (1º, 2º…); só para follow-ups. */
  numero?: number;
  onAlternar: () => void;
  onApagar: () => void;
  onEditado: () => void;
}) {
  const s = situacao(a);
  const feita = s === "feita";
  const [editando, setEditando] = useState(false);

  if (editando) {
    return (
      <li className="rounded-md border border-[var(--color-accent)]/50 bg-[var(--color-surface-2)] p-3">
        <EditarAtividade
          atividade={{ ...a, responsavel: responsavelDa(a) }}
          onCancelar={() => setEditando(false)}
          onSalvo={() => {
            setEditando(false);
            onEditado();
          }}
        />
      </li>
    );
  }

  return (
    <li className="group flex items-start gap-3 rounded-md bg-[var(--color-surface-2)] p-3">
      <button
        onClick={onAlternar}
        aria-label={feita ? "Reabrir" : "Marcar como feita"}
        title={feita ? "Reabrir (desfaz a conclusão)" : "Marcar como feita agora"}
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition-colors",
          feita
            ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-on-ink)]"
            : "hover:border-[var(--color-accent)]",
        )}
      >
        {feita && <Check className="size-3.5" strokeWidth={3} />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {numero && <NumeroFollowUp n={numero} />}
          <span className={cn("text-sm font-semibold", feita && "text-[var(--color-muted)] line-through")}>
            {a.title || (numero ? "Follow-up" : rotuloDaChave(chaveDoTipo(a), proprios))}
          </span>
          {a.title && !numero && (
            <span className="rounded-full border px-1.5 text-[10px] text-[var(--color-muted)]">
              {rotuloDaChave(chaveDoTipo(a), proprios)}
            </span>
          )}
          {!feita && (
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] font-semibold",
                s === "atrasada" && "bg-[color-mix(in_srgb,var(--color-hot)_18%,transparent)] text-[var(--color-hot)]",
                s === "hoje" && "bg-[color-mix(in_srgb,var(--color-yellow)_18%,transparent)] text-[var(--color-yellow)]",
                (s === "agendada" || s === "sem-data") && "bg-[var(--color-surface)] text-[var(--color-muted)]",
              )}
            >
              {ROTULO_SITUACAO[s]}
            </span>
          )}
        </div>

        <dl className="mt-1 space-y-0.5 text-[11px] text-[var(--color-muted)]">
          {a.dueAt && (
            <div>
              <dt className="inline">Para: </dt>
              <dd className="inline font-medium text-[var(--color-text)]">{diaSemanaHora(a.dueAt)}</dd>
            </div>
          )}
          {a.doneAt && (
            <div>
              <dt className="inline">Feita em: </dt>
              <dd className="inline font-medium text-[var(--color-accent)]">{dataHora(a.doneAt)}</dd>
            </div>
          )}
          {responsavelDa(a) && (
            <div>
              <dt className="inline">Responsável: </dt>
              <dd className="inline font-medium text-[var(--color-text)]">{responsavelDa(a)!.nome}</dd>
            </div>
          )}
          <div>
            <dt className="inline">Criada em: </dt>
            <dd className="inline">{dataHora(a.createdAt)}</dd>
          </div>
        </dl>
        {a.notes && <p className="mt-1.5 whitespace-pre-wrap text-xs text-[var(--color-text)]/85">{a.notes}</p>}
      </div>

      <button
        onClick={() => setEditando(true)}
        aria-label="Editar atividade"
        title="Editar atividade"
        className="rounded-full p-1 text-[var(--color-muted)] hover:text-[var(--color-text)]"
      >
        <Pencil className="size-3.5" />
      </button>
      <button
        onClick={onApagar}
        aria-label="Apagar atividade"
        title="Apagar atividade"
        className="rounded-full p-1 text-[var(--color-muted)] transition-opacity hover:text-[var(--color-hot)] sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
    </li>
  );
}

/** Selo do número do follow-up: "3º follow-up". */
export function NumeroFollowUp({ n }: { n: number }) {
  return (
    <span
      className="inline-flex items-center rounded-full bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[var(--color-accent)]"
      title={`Este é o ${ordinalFollowUp(n)} deste lead`}
    >
      {ordinalFollowUp(n)}
    </span>
  );
}
