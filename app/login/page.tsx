import Image from "next/image";
import { prisma } from "@/lib/db";
import { authConfigurado } from "@/lib/auth/sessao";
import { FormLogin } from "@/components/form-login";

export const dynamic = "force-dynamic";

export const metadata = { title: "Entrar · CRM Biomech" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string }>;
}) {
  const { de } = await searchParams;
  // Só caminhos internos: um "de=https://outro-site" viraria um redirecionamento
  // para fora do CRM logo depois do login. A barra invertida também: o
  // navegador lê "/\outro-site" como "//outro-site".
  const destino = de && /^\/(?![\/\\])[^\\\s]*$/.test(de) ? de : "/hoje";

  const configurado = authConfigurado();
  const semUsuarios = configurado ? (await prisma.user.count()) === 0 : false;

  return (
    <div className="grid flex-1 place-items-center overflow-y-auto px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <Image
            src="/brand/selo.png"
            alt="Instituto Biomech"
            width={112}
            height={112}
            priority
            className="size-28 rounded-full ring-1 ring-[var(--color-line)]/40"
          />
          <h1 className="display mt-5 text-3xl leading-none">
            <span className="block">CRM</span>
            <span className="block text-[var(--color-accent)]">Biomech</span>
          </h1>
          <span className="mt-4 block h-[3px] w-16 rounded-full bg-[var(--color-yellow)]" />
        </div>

        <section className="card mt-8 p-6">
          {!configurado ? (
            <Aviso titulo="Login ainda não configurado">
              Falta a variável <code>AUTH_SECRET</code> no servidor (um texto aleatório de
              pelo menos 32 caracteres). Depois de criar, reinicie o CRM.
            </Aviso>
          ) : semUsuarios ? (
            <Aviso titulo="Nenhum usuário cadastrado">
              Crie o primeiro administrador: no computador, rode{" "}
              <code>npm run usuario:criar</code> na pasta do CRM. Na Railway, defina as
              variáveis <code>ADMIN_EMAIL</code>, <code>ADMIN_NOME</code> e{" "}
              <code>ADMIN_SENHA</code> e reinicie — o acesso é criado na subida.
            </Aviso>
          ) : (
            <FormLogin destino={destino} />
          )}
        </section>

        <p className="mt-6 text-center text-xs text-[var(--color-muted)]">
          Instituto Biomech · Avaliação biomecânica e fisioterapia
        </p>
      </div>
    </div>
  );
}

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-[var(--color-yellow)]">{titulo}</h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)] [&_code]:rounded [&_code]:bg-[var(--color-surface-2)] [&_code]:px-1 [&_code]:text-[var(--color-text)]">
        {children}
      </p>
    </div>
  );
}
