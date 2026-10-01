"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Mail, Send } from "lucide-react";
import { cn } from "@/lib/utils";

/** Liga/desliga os e-mails de atividades da própria conta (em "Minha conta"). */
export function PreferenciaAvisos() {
  const [ligado, setLigado] = useState<boolean | null>(null);
  const [configurado, setConfigurado] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    void fetch("/api/conta/avisos")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setLigado(d.emailNotifications);
        setConfigurado(d.configurado);
      })
      .catch(() => {});
  }, []);

  async function alternar() {
    if (ligado === null) return;
    const novo = !ligado;
    setLigado(novo);
    setSalvando(true);
    const res = await fetch("/api/conta/avisos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailNotifications: novo }),
    }).catch(() => null);
    setSalvando(false);
    if (!res?.ok) setLigado(!novo);
  }

  if (ligado === null) return null;

  return (
    <div className="mt-4 flex items-start gap-3 rounded-2xl bg-[var(--color-surface-2)] p-3">
      {ligado ? (
        <Bell className="mt-0.5 size-4 shrink-0 text-[var(--color-accent)]" />
      ) : (
        <BellOff className="mt-0.5 size-4 shrink-0 text-[var(--color-muted)]" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Avisos de atividades por e-mail</p>
        <p className="text-xs text-[var(--color-muted)]">
          Lembrete antes de cada atividade e o resumo do dia de manhã.
          {!configurado && " (O envio de e-mails ainda não foi configurado pelo administrador.)"}
        </p>
      </div>
      <button
        role="switch"
        aria-checked={ligado}
        onClick={() => void alternar()}
        disabled={salvando}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60",
          ligado ? "bg-[var(--color-accent)]" : "bg-white/15",
        )}
        title={ligado ? "Desligar os e-mails" : "Ligar os e-mails"}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
            ligado ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}

type Situacao = {
  configurado: boolean;
  remetente: string | null;
  minutosAntes: number;
  horaDoResumo: number;
};

/** Seção de administrador: se o envio está configurado e um botão de teste. */
export function AvisosEmailAdmin() {
  const [s, setS] = useState<Situacao | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    void fetch("/api/avisos-email")
      .then((r) => (r.ok ? r.json() : null))
      .then(setS)
      .catch(() => {});
  }, []);

  async function testar() {
    setEnviando(true);
    setMsg(null);
    const res = await fetch("/api/avisos-email", { method: "POST" }).catch(() => null);
    const d = await res?.json().catch(() => null);
    setEnviando(false);
    if (res?.ok) setMsg({ ok: true, texto: `E-mail de teste enviado para ${d?.para}. Confira a caixa de entrada (e o spam).` });
    else setMsg({ ok: false, texto: d?.error ?? "Não consegui enviar." });
  }

  if (!s) return <p className="text-sm text-[var(--color-muted)]">Carregando…</p>;

  return (
    <div className="flex flex-col gap-3">
      {s.configurado ? (
        <p className="flex items-center gap-2 rounded-2xl bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] px-3 py-2 text-xs">
          <Mail className="size-4 shrink-0 text-[var(--color-accent)]" />
          <span>
            Ligado. Remetente: <strong>{s.remetente}</strong>. Lembrete {s.minutosAntes} min antes de cada
            atividade e resumo do dia às {s.horaDoResumo}h.
          </span>
        </p>
      ) : (
        <div className="rounded-2xl bg-[color-mix(in_srgb,var(--color-warm)_12%,transparent)] px-3 py-2 text-xs leading-relaxed">
          <p className="font-semibold">Ainda não configurado.</p>
          <ol className="mt-1 list-decimal pl-4">
            <li>Crie uma conta grátis em resend.com e gere uma chave de API (API Keys).</li>
            <li>
              Na Railway, no serviço do CRM, adicione as variáveis <code>RESEND_API_KEY</code> (a chave) e{" "}
              <code>EMAIL_REMETENTE</code> — por exemplo <code>CRM Biomech &lt;avisos@seudominio.com.br&gt;</code>.
            </li>
            <li>
              Para enviar a qualquer pessoa, verifique o seu domínio na Resend (Domains). Sem isso, use{" "}
              <code>onboarding@resend.dev</code>, que só entrega no e-mail da sua conta da Resend.
            </li>
          </ol>
        </div>
      )}

      <p className="text-xs text-[var(--color-muted)]">
        Quem recebe o lembrete: o vendedor do lead (etiqueta de vendedor ligada a um login) → quem marcou a
        atividade → os administradores. O resumo do dia vai para cada vendedor com as atividades dele, e para os
        administradores com as do time. Cada pessoa liga ou desliga em “Minha conta”.
      </p>

      <button
        onClick={() => void testar()}
        disabled={!s.configurado || enviando}
        className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm font-semibold text-[var(--color-on-ink)] disabled:opacity-40"
      >
        <Send className="size-4" />
        {enviando ? "Enviando…" : "Enviar e-mail de teste para mim"}
      </button>
      {msg && (
        <p className={cn("text-xs", msg.ok ? "text-[var(--color-accent)]" : "text-[var(--color-hot)]")}>{msg.texto}</p>
      )}
    </div>
  );
}
