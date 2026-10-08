import type { MetadataRoute } from "next";

/**
 * Manifesto de aplicativo: deixa "instalar" o CRM na tela de início do
 * celular. No iPhone é o que libera as notificações (a Apple só entrega para
 * sites adicionados à Tela de Início).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CRM Resenha TV",
    short_name: "Resenha CRM",
    description: "Funil de vendas da Resenha TV, conectado ao WhatsApp",
    lang: "pt-BR",
    start_url: "/hoje",
    scope: "/",
    display: "standalone",
    background_color: "#0a0705",
    theme_color: "#0a0705",
    icons: [
      { src: "/brand/resenha-app-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/resenha-app-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
