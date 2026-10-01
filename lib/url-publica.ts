/**
 * Endereço público do CRM — o que a Evolution usa para mandar o webhook e o
 * que aparece em Configurações.
 *
 * Por que não usar só a URL da requisição: atrás do proxy da Railway (e de
 * qualquer hospedagem), a requisição chega ao Next como `http://` interno. Um
 * webhook cadastrado em `http://` é redirecionado para `https://` pela
 * hospedagem, e um POST redirecionado perde o corpo — a mensagem some.
 *
 * Ordem: APP_URL (definida à mão) → domínio público que a Railway injeta
 * sozinha (RAILWAY_PUBLIC_DOMAIN) → a URL da própria requisição (rodando local).
 */
export function urlPublica(requisicao?: { url: string } | string): string {
  const definida = process.env.APP_URL?.trim();
  if (definida) return definida.replace(/\/$/, "");

  const railway = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railway) return `https://${railway}`;

  if (requisicao) {
    const u = new URL(typeof requisicao === "string" ? requisicao : requisicao.url);
    return u.origin;
  }
  return "http://localhost:3000";
}

/**
 * Para onde a Evolution manda os eventos.
 *
 * Com CRM e Evolution no mesmo projeto da Railway, dá para usar a rede
 * privada (WEBHOOK_BASE_URL=http://<serviço>.railway.internal:<porta>): o
 * tráfego não sai da Railway e não passa pelo proxy público. Sem isso, usa o
 * endereço público.
 */
export function urlDoWebhook(requisicao?: { url: string } | string): string {
  const base = process.env.WEBHOOK_BASE_URL?.trim().replace(/\/$/, "") || urlPublica(requisicao);
  return `${base}/api/webhooks/evolution`;
}

/** Está rodando hospedado (e não na máquina de alguém)? */
export function estaHospedado(): boolean {
  return Boolean(process.env.APP_URL?.trim() || process.env.RAILWAY_PUBLIC_DOMAIN?.trim());
}
