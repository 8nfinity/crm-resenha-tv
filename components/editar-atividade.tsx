"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { chaveDia, chaveDoTipo, juntarDataHora, tipoDaChave } from "@/lib/atividades";
import { SeletorDeTipo, useTiposProprios } from "@/components/tipos-atividade";
import { SeletorDePessoa, useEquipe } from "@/components/equipe";

export type AtividadeEditavel = {
  id: string;
  type: string;
  kindId?: string | null;
  title: string | null;
  notes?: string | null;
  dueAt: string | null;
  /** Quem vai fazer hoje (a pessoa atribuída ou, sem ela, quem criou). */
  responsavel?: { id: string; nome: string } | null;
};

/** "14:30" no fuso de quem está vendo. */
function horaLocal(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Editar uma atividade já criada: tipo, título, data, hora e anotações. O
 * mesmo formulário no painel do lead e no Calendário. Remarcar faz o lembrete
 * valer de novo para o horário novo.
 */
export function EditarAtividade({
  atividade,
  onSalvo,
  onCancelar,
}: {
  atividade: AtividadeEditavel;
  onSalvo: () => void;
  onCancelar: () => void;
}) {
  const { proprios, recarregar } = useTiposProprios();
  const [tipo, setTipo] = useState(chaveDoTipo(atividade));
  const [titulo, setTitulo] = useState(atividade.title ?? "");
  const [notas, setNotas] = useState(atividade.notes ?? "");
  const [data, setData] = useState(atividade.dueAt ? chaveDia(atividade.dueAt) : "");
  const [hora, setHora] = useState(atividade.dueAt ? horaLocal(atividade.dueAt) : "09:00");
  const equipe = useEquipe();
  const [responsavel, setResponsavel] = useState(atividade.responsavel?.id ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    const { type, kindId } = tipoDaChave(tipo);
    const res = await fetch(`/api/activities/${atividade.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        kindId,
        title: titulo.trim() || null,
        notes: notas.trim() || null,
        // Sem data: a atividade fica "sem data" (vale para o que foi registrado como feito).
        dueAt: data ? juntarDataHora(data, hora) : null,
        // Só manda se mudou: quem nunca foi atribuído continua "quem criou".
        ...(responsavel !== (atividade.responsavel?.id ?? "") ? { assignedToId: responsavel || null } : {}),
      }),
    }).catch(() => null);
    setSalvando(false);
    if (!res?.ok) return setErro("Não deu para salvar. Tente de novo.");
    onSalvo();
  }

  const campo =
    "w-full rounded-md border bg-[var(--color-surface)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]";

  return (
    <form onSubmit={salvar} className="flex flex-col gap-2">
      <SeletorDeTipo valor={tipo} onChange={setTipo} proprios={proprios} onMudouTipos={recarregar} />
      <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título (opcional)" maxLength={200} className={campo} />
      <div className="flex gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Data</span>
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={campo} />
        </label>
        <label className="w-28">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Hora</span>
          <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} disabled={!data} className={campo} />
        </label>
      </div>
      <label>
        <span className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Responsável</span>
        <SeletorDePessoa
          valor={responsavel}
          onChange={setResponsavel}
          pessoas={equipe.pessoas}
          atual={atividade.responsavel}
          rotuloVazio="Quem criou a atividade"
          className={campo}
        />
      </label>
      <textarea
        value={notas}
        onChange={(e) => setNotas(e.target.value)}
        placeholder="Anotações (opcional)"
        rows={2}
        maxLength={5000}
        className={`${campo} resize-y`}
      />
      {erro && <p className="text-xs text-[var(--color-hot)]">{erro}</p>}
      <div className="flex gap-2">
        <button
          disabled={salvando}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--color-ink)] px-3 py-2 text-sm font-semibold text-[var(--color-on-ink)] disabled:opacity-50"
        >
          {salvando && <Loader2 className="size-4 animate-spin" />}
          Salvar alterações
        </button>
        <button type="button" onClick={onCancelar} className="rounded-md border px-3 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)]">
          Cancelar
        </button>
      </div>
    </form>
  );
}
