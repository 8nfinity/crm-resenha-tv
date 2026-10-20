"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { ORIGENS, emailValido, lerValor, normalizarTelefone } from "@/lib/cadastro-lead";
import { cn } from "@/lib/utils";
import { SeletorDePessoa, useEquipe } from "@/components/equipe";

type Coluna = { id: string; name: string; isWon: boolean; isLost: boolean };

const campo =
  "w-full rounded-md border bg-[var(--color-surface)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]";

/**
 * Botão "+ Lead" do funil (como o "+ Negócio" do Pipedrive) e a janela de
 * cadastro. O lead entra no funil aberto, na coluna escolhida.
 */
export function NovoLead({
  colunas,
  contas,
}: {
  /** Colunas do funil aberto. */
  colunas: Coluna[];
  /** Números de WhatsApp do CRM; com mais de um, dá para escolher. */
  contas: { id: string; nome: string }[];
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-ink)] px-3 py-1.5 text-sm font-semibold text-[var(--color-on-ink)] hover:bg-[var(--color-ink-2)]"
      >
        <Plus className="size-4" strokeWidth={2.5} /> Lead
      </button>
      {aberto && <Formulario colunas={colunas} contas={contas} onFechar={() => setAberto(false)} />}
    </>
  );
}

function Formulario({ colunas, contas, onFechar }: { colunas: Coluna[]; contas: { id: string; nome: string }[]; onFechar: () => void }) {
  const router = useRouter();
  const emAndamento = colunas.filter((c) => !c.isWon && !c.isLost);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [valor, setValor] = useState("");
  const [origem, setOrigem] = useState("");
  const [outraOrigem, setOutraOrigem] = useState("");
  const [stageId, setStageId] = useState(emAndamento[0]?.id ?? colunas[0]?.id ?? "");
  const [accountId, setAccountId] = useState(contas[0]?.id ?? "");
  const [observacao, setObservacao] = useState("");
  const equipe = useEquipe();
  // Começa com quem está cadastrando; dá para trocar ou deixar sem ninguém.
  const [responsavel, setResponsavel] = useState<string | null>(null);
  const ownerId = responsavel ?? equipe.eu ?? "";
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [existente, setExistente] = useState<string | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);

  // Avisos enquanto digita, antes de mandar ao servidor.
  const foneOk = !telefone.trim() || normalizarTelefone(telefone) !== null;
  const emailOk = !email.trim() || emailValido(email);
  const valorNum = lerValor(valor);
  const valorOk = valorNum === null || !Number.isNaN(valorNum);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim() || !telefone.trim()) return setErro("Nome e telefone são obrigatórios.");
    if (!foneOk || !emailOk || !valorOk) return setErro("Confira os campos marcados em vermelho.");
    setSalvando(true);
    setErro(null);
    setExistente(null);
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome,
        telefone,
        email,
        empresa,
        valor: valorNum,
        origem: origem === "Outro" ? outraOrigem : origem,
        observacao,
        stageId,
        ownerId: ownerId || null,
        ...(accountId ? { accountId } : {}),
      }),
    }).catch(() => null);
    setSalvando(false);
    const corpo = await res?.json().catch(() => null);
    if (!res?.ok) {
      setErro(corpo?.error ?? "Não deu para cadastrar. Tente de novo.");
      if (corpo?.dealId) setExistente(corpo.dealId);
      return;
    }
    onFechar();
    // Abre o lead novo (o funil já recebe o card pelo "Ao vivo").
    router.push(`/funil?lead=${encodeURIComponent(corpo.dealId)}`);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-0 sm:p-4" onClick={onFechar}>
      <form
        onSubmit={salvar}
        onClick={(e) => e.stopPropagation()}
        className="glass-forte flex h-full w-full flex-col overflow-hidden sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:rounded-lg"
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-base font-bold">Novo lead</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="rounded-md p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]">
            <X className="size-4" />
          </button>
        </div>

        <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <Campo rotulo="Nome *">
            <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} placeholder="Nome da pessoa" className={campo} />
          </Campo>
          <Campo rotulo="Telefone / WhatsApp *" erro={!foneOk ? "DDD + número, ex.: (51) 98540-9366. De outro país, com +." : undefined}>
            <input
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              inputMode="tel"
              placeholder="(51) 98540-9366"
              className={cn(campo, !foneOk && "border-[var(--color-hot)]")}
            />
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="E-mail" erro={!emailOk ? "E-mail inválido." : undefined}>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" placeholder="nome@empresa.com" className={cn(campo, !emailOk && "border-[var(--color-hot)]")} />
            </Campo>
            <Campo rotulo="Empresa">
              <input value={empresa} onChange={(e) => setEmpresa(e.target.value)} maxLength={120} placeholder="Nome da empresa ou negócio" className={campo} />
            </Campo>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Valor do negócio (R$)" erro={!valorOk ? "Valor inválido." : undefined}>
              <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="Ex.: 2.500,00" className={cn(campo, !valorOk && "border-[var(--color-hot)]")} />
            </Campo>
            <Campo rotulo="Origem">
              <select value={origem} onChange={(e) => setOrigem(e.target.value)} className={campo}>
                <option value="">Não informada</option>
                {ORIGENS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
                <option value="Outro">Outro…</option>
              </select>
              {origem === "Outro" && (
                <input value={outraOrigem} onChange={(e) => setOutraOrigem(e.target.value)} maxLength={60} placeholder="De onde veio?" className={cn(campo, "mt-2")} />
              )}
            </Campo>
          </div>
          <div className={cn("grid gap-3", contas.length > 1 && "sm:grid-cols-2")}>
            <Campo rotulo="Entra na coluna">
              <select value={stageId} onChange={(e) => setStageId(e.target.value)} className={campo}>
                {colunas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Campo>
            {contas.length > 1 && (
              <Campo rotulo="Número de WhatsApp">
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={campo}>
                  {contas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </Campo>
            )}
          </div>
          <Campo rotulo="Responsável">
            <SeletorDePessoa valor={ownerId} onChange={setResponsavel} pessoas={equipe.pessoas} rotuloVazio="Sem responsável" className={campo} />
          </Campo>
          <Campo rotulo="Observação">
            <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3} maxLength={5000} placeholder="O que ele quer, como chegou até vocês…" className={cn(campo, "resize-y")} />
          </Campo>
          {erro && (
            <p className="rounded-md border border-[var(--color-hot)]/60 bg-[color-mix(in_srgb,var(--color-hot)_10%,transparent)] px-3 py-2 text-xs">
              {erro}
              {existente && (
                <button
                  type="button"
                  onClick={() => {
                    onFechar();
                    router.push(`/funil?lead=${encodeURIComponent(existente)}`);
                  }}
                  className="ml-2 font-semibold text-[var(--color-accent)] hover:underline"
                >
                  Abrir o lead
                </button>
              )}
            </p>
          )}
        </div>

        <div className="flex gap-2 border-t px-5 py-3">
          <button type="button" onClick={onFechar} className="rounded-md border px-4 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)]">
            Cancelar
          </button>
          <button
            disabled={salvando}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[var(--color-ink)] px-5 py-2 text-sm font-semibold text-[var(--color-on-ink)] disabled:opacity-50"
          >
            {salvando && <Loader2 className="size-4 animate-spin" />}
            Cadastrar lead
          </button>
        </div>
      </form>
    </div>
  );
}

function Campo({ rotulo, erro, children }: { rotulo: string; erro?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-[var(--color-muted)]">
      <span className="mb-1 block font-semibold">{rotulo}</span>
      {children}
      {erro && <span className="mt-1 block text-[var(--color-hot)]">{erro}</span>}
    </label>
  );
}
