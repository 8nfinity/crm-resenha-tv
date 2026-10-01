import type { NextConfig } from "next";

const producao = process.env.NODE_ENV === "production";

/**
 * Política de conteúdo (CSP): de onde a página pode carregar cada coisa.
 *
 * Tudo vem do próprio CRM, com duas exceções: as fotos de perfil, que vêm dos
 * servidores do WhatsApp, e imagens em data:/blob: (QR Code, PDF). Scripts de
 * outro site não rodam — é o que barra a maior parte dos ataques de injeção.
 *
 * 'unsafe-inline' nos scripts: o Next injeta pequenos scripts inline para
 * hidratar a página; sem ele, nada funciona. Em desenvolvimento a política
 * fica de fora (o modo dev usa eval para recarregar o código).
 */
const csp = [
  "default-src 'self'",
  // wasm-unsafe-eval: o leitor de e-book (pdf.js) decodifica algumas imagens
  // de PDF com WebAssembly. Não libera eval de JavaScript.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.whatsapp.net https://*.fbcdn.net",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Não anunciar "X-Powered-By: Next.js": não ajuda ninguém além de quem
  // procura alvos de uma versão específica.
  poweredByHeader: false,

  experimental: {
    // O proxy guarda o corpo da requisição na memória (padrão: 10 MB). O PDF
    // do playbook vai até 25 MB; acima disso a própria rota recusa.
    proxyClientMaxBodySize: "26mb",
  },

  images: {
    // Fotos de perfil vêm dos CDNs do WhatsApp.
    remotePatterns: [
      { protocol: "https", hostname: "*.whatsapp.net" },
      { protocol: "https", hostname: "*.fbcdn.net" },
    ],
  },

  async headers() {
    const seguranca = [
      // Ninguém embute o CRM num iframe (proteção contra clickjacking).
      { key: "X-Frame-Options", value: "DENY" },
      // O navegador não "adivinha" o tipo de um arquivo.
      { key: "X-Content-Type-Options", value: "nosniff" },
      // Links para fora não levam o endereço interno do CRM.
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // Recursos do aparelho que o CRM não usa ficam bloqueados.
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
      // Só HTTPS por 1 ano. Navegadores ignoram este cabeçalho em HTTP (localhost).
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      ...(producao ? [{ key: "Content-Security-Policy", value: csp }] : []),
    ];
    return [{ source: "/:path*", headers: seguranca }];
  },
};

export default nextConfig;
