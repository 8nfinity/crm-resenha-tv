"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Share, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Notificações no aparelho: o botão "Ativar notificações" e o convite na tela
 * Hoje. Cada aparelho (computador, celular) é ativado nele mesmo — é o
 * navegador daquele aparelho que recebe.
 */

type Situacao =
  | "carregando"
  | "sem-suporte" // navegador antigo
  | "iphone-instalar" // iPhone: só funciona adicionado à Tela de Início
  | "bloqueado" // a pessoa negou a permissão antes
  | "desligado"
  | "ligado";

function ehIphone(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function instaladoComoApp(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function chaveParaBytes(base64: string): Uint8Array<ArrayBuffer> {
  const preenchimento = "=".repeat((4 - (base64.length % 4)) % 4);
  const bruto = atob((base64 + preenchimento).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(bruto.length));
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i);
  return bytes;
}

/**
 * Espera no máximo alguns segundos. Navegador com o serviço de notificação
 * desligado (ex.: Brave sem a opção do Google) nunca responde — sem limite, o
 * botão ficaria em "Ativando…" para sempre.
 */
function comLimite<T>(promessa: Promise<T>, ms = 20_000): Promise<T> {
  return Promise.race([
    promessa,
    new Promise<T>((_, falhar) =>
      setTimeout(
        () =>
          falhar(
            new Error(
              "O navegador não respondeu ao ativar as notificações. Tente no Chrome ou no Edge — no Brave, ligue " +
                "em Configurações → Privacidade → “Usar serviços do Google para mensagens push”.",
            ),
          ),
        ms,
      ),
    ),
  ]);
}

async function registrarServiceWorker() {
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}

async function enviarInscricao(inscricao: PushSubscription) {
  const res = await fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(inscricao.toJSON()),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Não consegui ativar.");
}

export function useNotificacoes() {
  const [situacao, setSituacao] = useState<Situacao>("carregando");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const conferir = useCallback(async () => {
    const suporta = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!suporta) {
      setSituacao(ehIphone() && !instaladoComoApp() ? "iphone-instalar" : "sem-suporte");
      return;
    }
    if (Notification.permission === "denied") {
      setSituacao("bloqueado");
      return;
    }
    const registro = await navigator.serviceWorker.getRegistration("/");
    const inscricao = await registro?.pushManager.getSubscription();
    if (inscricao && Notification.permission === "granted") {
      // Reenvia a inscrição: se outra pessoa logou neste navegador, os avisos
      // passam a ir para quem está logado agora.
      await enviarInscricao(inscricao).catch(() => {});
      setSituacao("ligado");
    } else {
      setSituacao("desligado");
    }
  }, []);

  useEffect(() => {
    void conferir().catch(() => setSituacao("sem-suporte"));
  }, [conferir]);

  async function ativar() {
    setErro(null);
    setOcupado(true);
    try {
      // A permissão tem que ser pedida logo no clique (o Safari exige).
      const permissao = await Notification.requestPermission();
      if (permissao !== "granted") {
        setSituacao(permissao === "denied" ? "bloqueado" : "desligado");
        return;
      }
      const [registro, chave] = await comLimite(
        Promise.all([
          registrarServiceWorker(),
          fetch("/api/push").then((r) => r.json() as Promise<{ chavePublica: string }>),
        ]),
      );
      const inscricao =
        (await registro.pushManager.getSubscription()) ??
        (await comLimite(
          registro.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: chaveParaBytes(chave.chavePublica),
          }),
        ));
      await enviarInscricao(inscricao);
      setSituacao("ligado");
    } catch (e) {
      setErro((e as Error).message || "Não consegui ativar as notificações neste aparelho.");
    } finally {
      setOcupado(false);
    }
  }

  async function desativar() {
    setErro(null);
    setOcupado(true);
    try {
      const registro = await navigator.serviceWorker.getRegistration("/");
      const inscricao = await registro?.pushManager.getSubscription();
      if (inscricao) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: inscricao.endpoint }),
        });
        await inscricao.unsubscribe();
      }
      setSituacao("desligado");
    } finally {
      setOcupado(false);
    }
  }

  async function testar(): Promise<string> {
    const res = await fetch("/api/push/teste", { method: "POST" }).catch(() => null);
    const d = await res?.json().catch(() => null);
    if (res?.ok) return "Pronto! A notificação de teste deve aparecer em instantes.";
    return d?.error ?? "Não consegui enviar o teste.";
  }

  return { situacao, ocupado, erro, ativar, desativar, testar };
}

const botao =
  "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50";

/** Instruções para o iPhone: notificação só com o CRM na Tela de Início. */
function InstrucaoIphone() {
  return (
    <p className="text-xs leading-relaxed text-[var(--color-muted)]">
      No iPhone, as notificações só funcionam com o CRM instalado: no Safari, toque em{" "}
      <Share className="inline size-3.5 align-text-bottom" /> <strong>Compartilhar</strong> →{" "}
      <strong>Adicionar à Tela de Início</strong>, abra o CRM pelo ícone novo e ative aqui. (Precisa do iOS 16.4 ou
      mais novo.)
    </p>
  );
}

/** Cartão em Configurações → Minha conta. */
export function NotificacoesAparelho() {
  const { situacao, ocupado, erro, ativar, desativar, testar } = useNotificacoes();
  const [msg, setMsg] = useState<string | null>(null);

  if (situacao === "carregando") return null;

  return (
    <div className="mt-4 rounded-2xl bg-[var(--color-surface-2)] p-3">
      <div className="flex items-start gap-3">
        {situacao === "ligado" ? (
          <BellRing className="mt-0.5 size-4 shrink-0 text-[var(--color-accent)]" />
        ) : (
          <Bell className="mt-0.5 size-4 shrink-0 text-[var(--color-muted)]" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Notificações neste aparelho</p>
          <p className="text-xs text-[var(--color-muted)]">
            {situacao === "ligado"
              ? "Ligadas. Os lembretes das suas atividades e o resumo do dia chegam aqui, mesmo com o CRM fechado."
              : "Receba os lembretes das suas atividades como notificação, no computador e no celular. Ative em cada aparelho que você usa."}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 pl-7">
        {situacao === "desligado" && (
          <button onClick={() => void ativar()} disabled={ocupado} className={cn(botao, "bg-[var(--color-ink)] text-[var(--color-on-ink)]")}>
            <Bell className="size-4" />
            {ocupado ? "Ativando…" : "Ativar notificações"}
          </button>
        )}
        {situacao === "ligado" && (
          <>
            <button
              onClick={() => void testar().then(setMsg)}
              className={cn(botao, "bg-[var(--color-ink)] text-[var(--color-on-ink)]")}
            >
              <BellRing className="size-4" />
              Enviar notificação de teste
            </button>
            <button onClick={() => void desativar()} disabled={ocupado} className={cn(botao, "border font-normal text-[var(--color-muted)] hover:text-[var(--color-text)]")}>
              <BellOff className="size-4" />
              Desligar neste aparelho
            </button>
          </>
        )}
        {situacao === "iphone-instalar" && <InstrucaoIphone />}
        {situacao === "bloqueado" && (
          <p className="text-xs leading-relaxed text-[var(--color-hot)]">
            As notificações estão bloqueadas para o CRM neste navegador. Clique no cadeado ao lado do endereço do site
            → Notificações → Permitir, e recarregue a página.
          </p>
        )}
        {situacao === "sem-suporte" && (
          <p className="text-xs text-[var(--color-muted)]">
            Este navegador não recebe notificações. Use o Chrome, o Edge ou o Firefox atualizados.
          </p>
        )}
      </div>
      {(msg || erro) && (
        <p className={cn("mt-2 pl-7 text-xs", erro ? "text-[var(--color-hot)]" : "text-[var(--color-accent)]")}>{erro ?? msg}</p>
      )}
    </div>
  );
}

const CHAVE_CONVITE = "crm:convite-notificacoes-fechado";

/** Convite discreto na tela Hoje, para quem ainda não ativou neste aparelho. */
export function ConviteNotificacoes() {
  const { situacao, ocupado, erro, ativar } = useNotificacoes();
  const [fechado, setFechado] = useState(true);

  useEffect(() => {
    try {
      setFechado(localStorage.getItem(CHAVE_CONVITE) === "1");
    } catch {
      setFechado(false);
    }
  }, []);

  function fechar() {
    setFechado(true);
    try {
      localStorage.setItem(CHAVE_CONVITE, "1");
    } catch {
      // Sem armazenamento: o convite volta na próxima visita.
    }
  }

  if (fechado || (situacao !== "desligado" && situacao !== "iphone-instalar")) return null;

  return (
    <div className="glass mx-4 mb-4 flex items-start gap-3 rounded-2xl px-4 py-3 sm:mx-8">
      <BellRing className="mt-0.5 size-5 shrink-0 text-[var(--color-accent)]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Receba os lembretes como notificação</p>
        {situacao === "iphone-instalar" ? (
          <InstrucaoIphone />
        ) : (
          <p className="text-xs text-[var(--color-muted)]">
            O CRM avisa neste aparelho antes de cada follow-up e reunião, mesmo fechado.
          </p>
        )}
        {erro && <p className="mt-1 text-xs text-[var(--color-hot)]">{erro}</p>}
      </div>
      {situacao === "desligado" && (
        <button onClick={() => void ativar()} disabled={ocupado} className={cn(botao, "shrink-0 bg-[var(--color-ink)] text-[var(--color-on-ink)]")}>
          {ocupado ? "Ativando…" : "Ativar"}
        </button>
      )}
      <button onClick={fechar} aria-label="Fechar" className="icon-btn shrink-0 text-[var(--color-muted)]">
        <X className="size-4" />
      </button>
    </div>
  );
}
