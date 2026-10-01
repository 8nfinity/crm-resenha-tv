import type { MetadataRoute } from "next";

/**
 * Manifesto de aplicativo: deixa "instalar" o CRM na tela de início do
 * celular. No iPhone é o que libera as notificações (a Apple só entrega para
 * sites adicionados à Tela de Início).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CRM Biomech",
    short_name: "CRM Biomech",
    description: "Funil de vendas do Instituto Biomech, conectado ao WhatsApp",
    lang: "pt-BR",
    start_url: "/hoje",
    scope: "/",
    display: "standalone",
    background_color: "#030b07",
    theme_color: "#0b1d14",
    icons: [
      { src: "/brand/app-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/app-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
