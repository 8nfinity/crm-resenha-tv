import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import { BarraTopo, MenuLateral } from "@/components/top-nav";
import { usuarioAtual } from "@/lib/auth/usuario";
import { SessaoProvider } from "@/components/sessao";
import "./globals.css";

// Geométrica e pesada como o "RESENHA TV" da logo: títulos em
// caixa alta 900, números grandes das métricas em 700.
const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
});

export const metadata: Metadata = {
  title: "CRM Resenha TV",
  description: "Funil de vendas da Resenha TV, conectado ao WhatsApp",
  icons: { icon: "/brand/resenha-marca.png", apple: "/brand/resenha-apple-180.png" },
  // Instalado na Tela de Início do iPhone, abre como aplicativo (sem a barra
  // do Safari) — e é assim que o iPhone recebe as notificações.
  appleWebApp: { capable: true, title: "CRM Resenha TV", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0a0705",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Na tela de login não há usuário; a barra do topo some sozinha lá.
  const usuario = await usuarioAtual();

  return (
    <html lang="pt-BR" className={montserrat.variable}>
      <body className="flex h-screen flex-col overflow-hidden">
        {/* As barras de cor da TV no topo do app: a assinatura da Resenha TV. */}
        <div className="barras-tv h-[3px] shrink-0" aria-hidden />
        {/* Layout do Pipedrive: menu lateral, e à direita a barra de topo e a tela. */}
        <div className="flex min-h-0 flex-1">
          <MenuLateral usuario={usuario} />
          {/* No celular, espaço para a barra de navegação de baixo. */}
          <div className="flex min-w-0 flex-1 flex-col pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0">
            <BarraTopo usuario={usuario} />
            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <SessaoProvider papel={usuario?.role ?? null}>{children}</SessaoProvider>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
