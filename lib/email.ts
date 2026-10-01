/**
 * Envio de e-mail pela API HTTP da Resend (resend.com).
 *
 * Por que HTTP e não SMTP: a Railway bloqueia a saída SMTP (portas 25/465/587)
 * nos planos comuns, e um envio que trava esperando conexão derruba a rotina
 * inteira. A API HTTP passa pela porta 443 como qualquer requisição.
 *
 * Variáveis:
 *   RESEND_API_KEY   a chave criada no painel da Resend (começa com "re_")
 *   EMAIL_REMETENTE  quem envia, ex.: "CRM Biomech <avisos@seudominio.com.br>"
 *                    (o domínio precisa estar verificado na Resend; para testar,
 *                    "onboarding@resend.dev" envia só para o e-mail da sua conta)
 */

export type Email = {
  para: string | string[];
  assunto: string;
  html: string;
  texto: string;
};

export function emailConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_REMETENTE?.trim());
}

export function remetente(): string | null {
  return process.env.EMAIL_REMETENTE?.trim() || null;
}

/** Envia um e-mail. Nunca lança: devolve o erro em texto, para a tela mostrar. */
export async function enviarEmail(email: Email): Promise<{ ok: true } | { ok: false; erro: string }> {
  const chave = process.env.RESEND_API_KEY?.trim();
  const de = remetente();
  if (!chave || !de) {
    return { ok: false, erro: "E-mail não configurado: defina RESEND_API_KEY e EMAIL_REMETENTE nas variáveis." };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: de,
        to: Array.isArray(email.para) ? email.para : [email.para],
        subject: email.assunto,
        html: email.html,
        text: email.texto,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true };

    const corpo = (await res.json().catch(() => null)) as { message?: string } | null;
    const motivo = corpo?.message ?? `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      return { ok: false, erro: `A Resend recusou o envio (${motivo}). Confira a RESEND_API_KEY e se o domínio do remetente está verificado.` };
    }
    return { ok: false, erro: `A Resend recusou o envio: ${motivo}` };
  } catch (error) {
    return { ok: false, erro: `Não consegui falar com a Resend: ${(error as Error).message}` };
  }
}

/** Escapa texto que vai dentro do HTML — nome de lead e título de atividade vêm de fora. */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Moldura do e-mail na identidade Biomech: fundo verde-escuro, faixa amarela,
 * Montserrat quando o leitor de e-mail tiver (senão, a fonte sem serifa dele).
 * Tudo em estilo inline: a maioria dos leitores ignora <style>.
 */
export function moldura({
  titulo,
  corpoHtml,
  botao,
}: {
  titulo: string;
  corpoHtml: string;
  botao?: { texto: string; url: string };
}): string {
  const fonte = "Montserrat, 'Segoe UI', Helvetica, Arial, sans-serif";
  const botaoHtml = botao
    ? `<tr><td style="padding:8px 32px 28px"><a href="${escaparHtml(botao.url)}" style="display:inline-block;background:#f2d417;color:#0b1d14;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:999px;font-family:${fonte};font-size:14px">${escaparHtml(botao.texto)}</a></td></tr>`
    : "";
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escaparHtml(titulo)}</title></head>
<body style="margin:0;padding:0;background:#030b07">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#030b07;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0b1d14;border-radius:20px;overflow:hidden;border:1px solid #1d3a2b">
<tr><td style="height:5px;background:#f2d417;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:26px 32px 6px;font-family:${fonte};color:#2fe38c;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase">Instituto Biomech · CRM</td></tr>
<tr><td style="padding:0 32px 14px;font-family:${fonte};color:#ffffff;font-size:22px;font-weight:700;line-height:1.3">${escaparHtml(titulo)}</td></tr>
<tr><td style="padding:0 32px 18px;font-family:${fonte};color:#d6e4dc;font-size:14px;line-height:1.6">${corpoHtml}</td></tr>
${botaoHtml}
<tr><td style="padding:16px 32px 22px;border-top:1px solid #1d3a2b;font-family:${fonte};color:#7f9a8c;font-size:11px;line-height:1.5">Você recebe este aviso porque os e-mails de atividades estão ligados na sua conta do CRM. Para desligar: Configurações → Minha conta.</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
