import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import { TopNav } from "@/components/top-nav";
import "./globals.css";

// A mesma família geométrica e pesada dos materiais da Biomech: títulos em
// caixa alta 900, números grandes das métricas em 700.
const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
});

export const metadata: Metadata = {
  title: "CRM Biomech",
  description: "Funil de vendas do Instituto Biomech, conectado ao WhatsApp",
  icons: { icon: "/brand/marca.png", apple: "/brand/marca.png" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={montserrat.variable}>
      <body className="flex h-screen flex-col overflow-hidden">
        <TopNav />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </body>
    </html>
  );
}
