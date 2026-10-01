import { headers } from "next/headers";
import { StageEditor } from "@/components/stage-editor";
import { CopyField } from "@/components/copy-field";
import { EtiquetasEIgnorados } from "@/components/contatos-ignorados";
import { CustomFieldEditor } from "@/components/custom-field-editor";
import { prisma } from "@/lib/db";
import { urlDoWebhook, urlPublica } from "@/lib/url-publica";
import { usuarioAtual } from "@/lib/auth/usuario";
import { ehAdministrador } from "@/lib/auth/papeis";
import { GerenciarUsuarios, MinhaConta } from "@/components/usuarios";
import { PageHeader } from "@/components/ui";
import { AvisosEmailAdmin, PreferenciaAvisos } from "@/components/avisos-email";
import { NotificacoesAparelho } from "@/components/notificacoes";
import { emailConfigurado } from "@/lib/email";

export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  // Hospedado, vale o endereço público configurado (o do cabeçalho pode ser
  // o interno do proxy); local, o da própria requisição.
  const base = urlPublica(`${proto}://${host}`);
  const webhookUrl = urlDoWebhook(`${proto}://${host}`);

  const contas = await prisma.whatsAppAccount.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true, status: true },
  });

  const usuario = await usuarioAtual();
  const admin = ehAdministrador(usuario?.role);

  // O endereço do conector carrega o segredo que dá acesso a todos os leads:
  // só o administrador vê. Vendedor não recebe nem o valor na página.
  const secret = admin ? process.env.MCP_SECRET_PATH : undefined;
  const mcpUrl = secret ? `${base}/api/mcp/${secret}` : null;
  const ipCheckOff = process.env.MCP_DISABLE_IP_CHECK === "true";
  const emProducao = !new URL(base).hostname.startsWith("localhost");

  return (
    <>
      <div className="scroll-thin flex-1 overflow-y-auto pb-10">
      <PageHeader
        title="Configurações"
        subtitle={admin ? "Acessos, notificações, conector do Claude, webhook, etiquetas, campos e estágios." : "Sua conta de acesso ao CRM."}
      />
      <div className="px-4 sm:px-8">
        <div className="grid max-w-6xl grid-cols-1 gap-5 lg:grid-cols-2">
          {usuario && (
            <section id="conta" className="card scroll-mt-4 p-6">
              <h2 className="text-base font-semibold">Minha conta</h2>
              <p className="mt-1 mb-3 text-xs text-[var(--color-muted)]">
                Trocar a senha desconecta os outros aparelhos onde você estava logado.
              </p>
              <MinhaConta nome={usuario.name} email={usuario.email} />
              <NotificacoesAparelho />
              <PreferenciaAvisos />
            </section>
          )}

          {admin && usuario && (
            <section className="card p-6">
              <h2 className="text-base font-semibold">Usuários</h2>
              <p className="mt-1 mb-3 text-xs text-[var(--color-muted)]">
                Cada pessoa do time com o próprio acesso. Administradores gerenciam os
                acessos e veem as seções técnicas; vendedores usam o CRM normalmente.
              </p>
              <GerenciarUsuarios meuId={usuario.id} meuPapel={usuario.role} />
            </section>
          )}

          {admin && (<>
          {/* E-mail é opcional (os avisos chegam como notificação no aparelho):
              a seção só aparece quando o envio está configurado. Como
              configurar fica no README. */}
          {emailConfigurado() && (
            <section className="card p-6">
              <h2 className="text-base font-semibold">Avisos por e-mail</h2>
              <p className="mt-1 mb-3 text-xs text-[var(--color-muted)]">
                Além das notificações nos aparelhos, os lembretes também saem por e-mail.
              </p>
              <AvisosEmailAdmin />
            </section>
          )}

          <section className="card p-6">
            <h2 className="text-base font-semibold">Conector do Claude</h2>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              No claude.ai: Configurações → Conectores → Adicionar conector
              personalizado, e cole esta URL.
            </p>

            {mcpUrl ? (
              <CopyField value={mcpUrl} className="mt-3" />
            ) : (
              <p className="mt-3 rounded-2xl bg-[color-mix(in_srgb,var(--color-hot)_12%,transparent)] px-3 py-2 text-xs">
                MCP_SECRET_PATH não está definida — o endpoint está desativado.
              </p>
            )}

            {ipCheckOff && emProducao && (
              <p className="mt-2 rounded-2xl bg-[color-mix(in_srgb,var(--color-hot)_15%,transparent)] px-3 py-2 text-xs">
                <strong>Atenção:</strong> MCP_DISABLE_IP_CHECK está ligado em
                produção. Qualquer pessoa com essa URL lê todos os seus leads.
                Mude para &quot;false&quot; nas variáveis de ambiente da hospedagem (Railway).
              </p>
            )}

            {!emProducao && (
              <p className="mt-2 text-xs text-[var(--color-muted)]">
                Você está em localhost: o claude.ai não alcança este endereço. Só
                depois do deploy essa URL funciona como conector.
              </p>
            )}
          </section>

          <section className="card p-6">
            <h2 className="text-base font-semibold">Webhook da Evolution API</h2>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              Configurado automaticamente ao gerar o QR Code. Esta é a URL, caso
              precise apontar na mão pelo painel da Evolution.
            </p>
            <CopyField value={webhookUrl} className="mt-3" />
          </section>

          <section className="card p-6">
            <h2 className="text-base font-semibold">
              Etiquetas e listas do WhatsApp
            </h2>
            <p className="mt-1 mb-3 text-xs text-[var(--color-muted)]">
              Etiquete a conversa (ou coloque numa lista) no celular e o lead anda no funil sozinho,
              registra quem atendeu (opção “Atendente”) ou, com “Ignorar contato”,
              some do CRM (família, fornecedor, equipe). Toda etiqueta fica no
              histórico do lead, na aba Notas. O sentido é único: mover o card aqui não aplica etiqueta lá.
            </p>
            <EtiquetasEIgnorados contas={contas} />
          </section>

          <section className="card p-6">
            <h2 className="text-base font-semibold">Campos próprios do lead</h2>
            <p className="mt-1 mb-3 text-xs text-[var(--color-muted)]">
              O que você acompanha além do padrão: origem, segmento, o que for.
              Campos de seleção viram filtro no funil automaticamente.
            </p>
            <CustomFieldEditor />
          </section>

          <section className="card p-6">
            <h2 className="text-base font-semibold">Estágios do funil</h2>
            <p className="mt-1 mb-3 text-xs text-[var(--color-muted)]">
              As colunas do kanban. Renomear é seguro a qualquer momento; apagar
              só é possível em estágio vazio e sem histórico.
            </p>
            <StageEditor />
          </section>
          </>)}
        </div>
      </div>
      </div>
    </>
  );
}
