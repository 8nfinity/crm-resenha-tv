import { NextResponse } from "next/server";
import { COOKIE_SESSAO } from "@/lib/auth/sessao";

export const runtime = "nodejs";

/** Sai do CRM: apaga o cookie de sessão deste navegador. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_SESSAO, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
