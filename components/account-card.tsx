"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  QrCode,
  Download,
  Loader2,
  Power,
  AlertCircle,
  CheckCircle2,
  Combine,
} from "lucide-react";
import type { ContaResumo } from "@/lib/accounts";
import { cn } from "@/lib/utils";

const LOTE = 8; // precisa bater com MAX_JIDS_POR_LOTE na rota de importação

// O WhatsApp invalida o QR em torno de 20s. Renovamos um pouco antes, para
// nunca mostrar um código já morto.
const SEGUNDOS_QR = 18;

type Chat = { waJid: string; jaImportado: boolean };

export function AccountCard({
  conta,
  onMudou,
}: {
  conta: ContaResumo;
  onMudou: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [gerandoQr, setGerandoQr] = useState(false);
  const [avisoWebhook, setAvisoWebhook] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resumo, setResumo] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(
    null,
  );
  const [confirmando, setConfirmando] = useState(false);
  const [editandoNome, setEditandoNome] = useState(false);
  const [juntando, setJuntando] = useState(false);

  const cancelarRef = useRef(false);
  const importandoRef = useRef(false);
  const listandoRef = useRef(false);
  const estadoAnteriorRef = useRef(conta.status);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const conectado = conta.status === "open";

  // ── QR Code ────────────────────────────────────────────────────────────────

  const gerarQr = useCallback(
    async (silencioso = false) => {
      if (!silencioso) {
        setErro(null);
        setGerandoQr(true);
      }
      try {
        const pedir = async () => {
          const res = await fetch(`/api/accounts/${conta.id}/connect`, {
            method: "POST",
          });
          return { ok: res.ok, data: await res.json() };
        };

        let { ok, data } = await pedir();
        if (!ok) {
          setErro(data.error ?? "Falha ao gerar o QR Code");
          return;
        }

        // A Evolution às vezes responde sem o QR quando o socket ainda está
        // subindo. Sem esta segunda tentativa, o primeiro clique parece não
        // fazer nada.
        if (!data.base64) {
          await new Promise((r) => setTimeout(r, 1500));
          ({ data } = await pedir());
        }

        if (!data.base64) {
          setErro("A Evolution não devolveu o QR Code. Tente de novo.");
          return;
        }

        setQr(data.base64);
        setSegundos(SEGUNDOS_QR);
        setAvisoWebhook(data.webhookConfigurado === false);
      } catch {
        setErro("Não consegui falar com a Evolution API.");
      } finally {
        setGerandoQr(false);
      }
    },
    [conta.id],
  );

  // Enquanto o QR está na tela, verifica se o celular já pareou.
  useEffect(() => {
    if (!qr) return;
    pollRef.current = setInterval(onMudou, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [qr, onMudou]);

  // Renova o QR antes de expirar. Sem isso você fica olhando para um código
  // morto: ele aparece normalmente, mas escanear não faz nada.
  useEffect(() => {
    if (!qr) return;
    const t = setInterval(() => {
      setSegundos((s) => {
        if (s <= 1) {
          void gerarQr(true);
          return SEGUNDOS_QR;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [qr, gerarQr]);

  // Pareou: o QR já não serve, e a importação começa sozinha.
  useEffect(() => {
    const acabouDeConectar = conectado && estadoAnteriorRef.current !== "open";
    estadoAnteriorRef.current = conta.status;

    if (acabouDeConectar) {
      setQr(null);
      if (!importandoRef.current) void importarTodas();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conta.status, conectado]);

  // ── Importação ─────────────────────────────────────────────────────────────

  async function importarJids(jids: string[]) {
    if (jids.length === 0 || importandoRef.current) return;

    importandoRef.current = true;
    cancelarRef.current = false;
    setProgresso({ feitos: 0, total: jids.length });
    setResumo(null);

    let mensagens = 0;
    let falhas = 0;
    let processados = 0;

    // Lotes pequenos e sequenciais. Cada conversa puxa até 300 mensagens:
    // mandar tudo de uma vez estouraria o tempo limite da requisição.
    for (let i = 0; i < jids.length; i += LOTE) {
      if (cancelarRef.current) break;
      const fatia = jids.slice(i, i + LOTE);

      try {
        const res = await fetch(`/api/accounts/${conta.id}/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jids: fatia }),
        });
        if (res.ok) {
          const data = await res.json();
          mensagens += data.totalMensagens ?? 0;
          falhas += data.resultados.filter((r: { erro?: string }) => r.erro).length;
        } else {
          falhas += fatia.length;
        }
      } catch {
        falhas += fatia.length;
      }

      processados = Math.min(i + LOTE, jids.length);
      setProgresso({ feitos: processados, total: jids.length });
    }

    const cancelado = cancelarRef.current;
    importandoRef.current = false;
    setProgresso(null);
    setResumo(
      `${processados - falhas} de ${jids.length} conversas importadas, ` +
        `${mensagens} mensagens` +
        (falhas > 0 ? ` · ${falhas} falharam` : "") +
        (cancelado ? " · interrompido" : ""),
    );
    onMudou();
  }

  /** Traz para o funil tudo desta conta que ainda não está lá. */
  async function importarTodas() {
    // A trava de importarJids só liga depois da listagem, que leva segundos.
    // Nesse intervalo o parear + um clique no botão disparavam duas
    // importações do mesmo número, disputando os mesmos contatos.
    if (importandoRef.current || listandoRef.current) return;
    listandoRef.current = true;
    setErro(null);
    try {
      const res = await fetch(`/api/accounts/${conta.id}/import`);
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Falha ao listar conversas");
        return;
      }
      const faltando = data.itens
        .filter((c: Chat) => !c.jaImportado)
        .map((c: Chat) => c.waJid);

      if (faltando.length === 0) {
        setResumo("Todas as conversas já estão no funil.");
        return;
      }
      listandoRef.current = false;
      await importarJids(faltando);
    } catch {
      setErro("Não consegui falar com a Evolution API.");
    } finally {
      listandoRef.current = false;
    }
  }

  /**
   * A mesma pessoa em dois cards (pelo telefone e pelo código interno do
   * WhatsApp, ou o celular com e sem o 9) vira um card só, com tudo junto.
   */
  async function juntarDuplicados() {
    setJuntando(true);
    setErro(null);
    setResumo(null);
    try {
      const res = await fetch(`/api/accounts/${conta.id}/duplicados`, { method: "POST" });
      const r = await res.json();
      if (!res.ok) {
        setErro(r.error ?? "Falha ao juntar os duplicados");
        return;
      }
      const juntados = r.pelaLid + r.peloNove;
      const partes = [
        juntados
          ? `${juntados} ${juntados === 1 ? "lead duplicado juntado" : "leads duplicados juntados"} (cada um virou um card só, com as conversas e notas juntas).`
          : "Nenhum duplicado para juntar agora.",
      ];
      if (r.restantes) partes.push(`Faltam ${r.restantes} para conferir — clique de novo.`);
      if (r.semTelefone) {
        partes.push(
          `${r.semTelefone} ${r.semTelefone === 1 ? "lead continua" : "leads continuam"} só com o código interno do WhatsApp: ` +
            "o número aparece quando a pessoa mandar mensagem, e o CRM junta sozinho se houver cópia.",
        );
      }
      if (r.emOutroNumero) {
        partes.push(
          `${r.emOutroNumero} ${r.emOutroNumero === 1 ? "pessoa também é lead" : "pessoas também são leads"} em outro número ` +
            "conectado — isso não é duplicado: cada número seu tem o seu card.",
        );
      }
      setResumo(partes.join(" "));
      if (juntados) onMudou();
    } catch {
      setErro("Não consegui falar com o servidor.");
    } finally {
      setJuntando(false);
    }
  }

  // ── Ações da conta ─────────────────────────────────────────────────────────

  async function renomear(label: string) {
    setEditandoNome(false);
    if (!label.trim() || label === conta.label) return;
    await fetch(`/api/accounts/${conta.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.trim() }),
    });
    onMudou();
  }

  async function desconectar(opcoes: { apagarDados?: boolean; remover?: boolean }) {
    const sp = new URLSearchParams();
    if (opcoes.apagarDados) sp.set("apagarDados", "true");
    if (opcoes.remover) sp.set("remover", "true");

    const res = await fetch(`/api/accounts/${conta.id}?${sp}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));

    setConfirmando(false);
    if (!res.ok) {
      setErro(data.error ?? "Falha ao desconectar");
      return;
    }
    setQr(null);
    onMudou();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "size-2.5 shrink-0 rounded-full",
            conectado
              ? "bg-[var(--color-accent)]"
              : conta.status === "connecting"
                ? "bg-[var(--color-warm)]"
                : "bg-[var(--color-hot)]",
          )}
          style={conectado ? { backgroundColor: conta.color } : undefined}
        />

        <div className="min-w-0 flex-1">
          {editandoNome ? (
            <input
              autoFocus
              defaultValue={conta.label ?? ""}
              onBlur={(e) => void renomear(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void renomear(e.currentTarget.value);
                if (e.key === "Escape") setEditandoNome(false);
              }}
              className="w-full rounded bg-[var(--color-surface-2)] px-2 py-0.5 text-sm outline-none"
            />
          ) : (
            <button
              onClick={() => setEditandoNome(true)}
              className="text-sm font-medium hover:underline"
              title="Clique para renomear"
            >
              {conta.label ?? conta.instanceName}
            </button>
          )}

          <p className="text-xs text-[var(--color-muted)]">
            {conectado
              ? conta.phone
                ? `+${conta.phone} · conectado`
                : "conectado"
              : conta.status === "connecting"
                ? "conectando…"
                : conta.status === "not_found"
                  ? "instância não existe na Evolution"
                  : "desconectado"}
            {conta.leads > 0 && ` · ${conta.leads} leads`}
          </p>
        </div>

        {conectado ? (
          <>
            <button
              onClick={() => void importarTodas()}
              disabled={progresso !== null}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-ink)] px-3 py-1.5 text-sm font-medium text-[var(--color-on-ink)] disabled:opacity-40"
            >
              <Download className="size-4" />
              Importar todas
            </button>
            <button
              onClick={() => void juntarDuplicados()}
              disabled={juntando || progresso !== null}
              title="Junta a mesma pessoa que aparece em dois cards"
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
            >
              {juntando ? <Loader2 className="size-4 animate-spin" /> : <Combine className="size-4" />}
              {juntando ? "Juntando…" : "Juntar duplicados"}
            </button>
            <button
              onClick={() => setConfirmando(true)}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-hot)]"
            >
              <Power className="size-4" />
              Desconectar
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => void gerarQr()}
              disabled={gerandoQr}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--color-ink)] px-3 py-1.5 text-sm font-medium text-[var(--color-on-ink)] disabled:opacity-60"
            >
              {gerandoQr ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <QrCode className="size-4" />
              )}
              {gerandoQr ? "Gerando…" : qr ? "Gerar outro" : "Conectar"}
            </button>
            <button
              onClick={() => setConfirmando(true)}
              className="rounded-full border px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-hot)]"
            >
              Remover
            </button>
          </>
        )}
      </div>

      <FunilDeEntrada conta={conta} onMudou={onMudou} />

      {erro && <p className="mt-2 text-xs text-[var(--color-hot)]">{erro}</p>}

      {resumo && (
        <p className="mt-2 flex items-center gap-1.5 rounded-2xl bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] px-3 py-2 text-xs">
          <CheckCircle2 className="size-3.5 shrink-0 text-[var(--color-accent)]" />
          {resumo}
        </p>
      )}

      {progresso && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
            <div
              className="h-full bg-[var(--color-accent)] transition-all"
              style={{ width: `${(progresso.feitos / progresso.total) * 100}%` }}
            />
          </div>
          <div className="mt-1 flex items-center gap-3">
            <p className="text-xs text-[var(--color-muted)]">
              Importando {progresso.feitos} de {progresso.total}… cada conversa puxa
              até 300 mensagens.
            </p>
            {/* Parar mantém o que já entrou: a importação é incremental. */}
            <button
              onClick={() => {
                cancelarRef.current = true;
              }}
              className="ml-auto shrink-0 rounded-full border px-2 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
            >
              Parar
            </button>
          </div>
        </div>
      )}

      {qr && (
        <div className="mt-4 flex flex-col items-center gap-2 border-t pt-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qr}
            alt="QR Code do WhatsApp"
            className="size-52 rounded-2xl bg-white p-3"
          />
          <p className="text-center text-sm">
            No celular: <strong>WhatsApp → Aparelhos conectados → Conectar aparelho</strong>
          </p>
          <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
            <div className="h-1 w-24 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
              <div
                className="h-full bg-[var(--color-accent)] transition-all duration-1000 ease-linear"
                style={{ width: `${(segundos / SEGUNDOS_QR) * 100}%` }}
              />
            </div>
            <span className="tabular-nums">renova em {segundos}s</span>
          </div>
          {avisoWebhook && (
            <p className="flex items-center gap-1.5 text-center text-xs text-[var(--color-warm)]">
              <AlertCircle className="size-3.5 shrink-0" />
              O webhook não pôde ser configurado: a Evolution não alcança este
              endereço. Mensagens novas não vão entrar sozinhas.
            </p>
          )}
        </div>
      )}

      {/* As três opções têm consequências diferentes, então são explícitas em
          vez de um "confirmar" genérico. */}
      {confirmando && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl bg-[var(--color-surface-2)] p-3">
          <p className="text-sm font-medium">
            O que fazer com {conta.label ?? "esta conta"}?
          </p>

          {conectado && (
            <button
              onClick={() => void desconectar({})}
              className="rounded-full border px-3 py-2 text-left text-sm hover:border-[var(--color-accent)]"
            >
              <span className="font-medium">Só desconectar</span>
              <span className="block text-xs text-[var(--color-muted)]">
                Desliga o celular. Os {conta.leads} leads ficam no funil e você pode
                reconectar o mesmo número depois.
              </span>
            </button>
          )}

          <button
            onClick={() => void desconectar({ apagarDados: true })}
            className="rounded-full border px-3 py-2 text-left text-sm hover:border-[var(--color-hot)]"
          >
            <span className="font-medium text-[var(--color-hot)]">
              Desconectar e apagar os dados
            </span>
            <span className="block text-xs text-[var(--color-muted)]">
              Remove os {conta.contatos} contatos e {conta.leads} leads desta conta.
              As outras contas não são afetadas.
            </span>
          </button>

          <button
            onClick={() => void desconectar({ remover: true })}
            className="rounded-full border px-3 py-2 text-left text-sm hover:border-[var(--color-hot)]"
          >
            <span className="font-medium text-[var(--color-hot)]">
              Remover a conta do CRM
            </span>
            <span className="block text-xs text-[var(--color-muted)]">
              Apaga tudo e tira a conta da lista. Reconectar exige criar outra.
            </span>
          </button>

          <button
            onClick={() => setConfirmando(false)}
            className="self-start px-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            Cancelar
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Em qual funil caem os leads novos deste número. Só aparece com mais de um
 * funil — com um só, não há o que escolher.
 */
function FunilDeEntrada({ conta, onMudou }: { conta: ContaResumo; onMudou: () => void }) {
  const [funis, setFunis] = useState<{ id: string; name: string }[]>([]);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    void fetch("/api/pipelines")
      .then((r) => (r.ok ? r.json() : []))
      .then(setFunis)
      .catch(() => {});
  }, []);

  if (funis.length < 2) return null;

  async function escolher(id: string) {
    setSalvando(true);
    await fetch(`/api/accounts/${conta.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryPipelineId: id || null }),
    }).catch(() => null);
    setSalvando(false);
    onMudou();
  }

  return (
    <label className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
      Leads novos deste número entram no funil
      <select
        // Sem escolha, vale o primeiro funil: é o que a lista mostra.
        value={funis.some((f) => f.id === conta.entryPipelineId) ? conta.entryPipelineId! : funis[0].id}
        disabled={salvando}
        onChange={(e) => void escolher(e.target.value)}
        className="rounded-full bg-[var(--color-surface-2)] px-3 py-1 text-sm text-[var(--color-text)] outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
      >
        {funis.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      {salvando && <Loader2 className="size-3.5 animate-spin" />}
    </label>
  );
}
