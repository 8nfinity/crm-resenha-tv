/*
 * Service worker do CRM Resenha TV: mostra as notificações das atividades mesmo
 * com o CRM fechado, e abre a tela certa quando a pessoa toca nelas.
 *
 * Não guarda páginas em cache (o CRM precisa estar online para funcionar):
 * a única função dele é receber notificações.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = { body: event.data ? event.data.text() : "" };
  }

  event.waitUntil(
    self.registration.showNotification(dados.title || "CRM Resenha TV", {
      body: dados.body || "",
      icon: "/brand/app-192.png",
      tag: dados.tag,
      // Mesma tag (ex.: o mesmo lembrete de novo) substitui e avisa de novo.
      renotify: Boolean(dados.tag),
      lang: "pt-BR",
      data: { url: dados.url || "/hoje" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = new URL((event.notification.data && event.notification.data.url) || "/hoje", self.location.origin).href;

  event.waitUntil(
    (async () => {
      // CRM já aberto em alguma aba: traz para a frente em vez de abrir outra.
      const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const janela of janelas) {
        if (new URL(janela.url).origin === self.location.origin) {
          await janela.focus();
          if ("navigate" in janela) await janela.navigate(destino).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(destino);
    })(),
  );
});
