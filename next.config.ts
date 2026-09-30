import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Fotos de perfil vêm dos CDNs do WhatsApp.
    remotePatterns: [
      { protocol: "https", hostname: "*.whatsapp.net" },
      { protocol: "https", hostname: "*.fbcdn.net" },
    ],
  },
};

export default nextConfig;
