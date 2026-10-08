# CRM de WhatsApp

Funil de vendas em kanban conectado ao seu WhatsApp, com os contatos e o
histórico de conversas importados, e um conector para perguntar ao Claude sobre
o próprio funil.

## Como as peças se encaixam

```
  Seu celular ──QR──> Evolution API (VPS, Docker)
                            │
                            │ webhook
                            ▼
                    CRM (Next.js na Vercel) ──> Postgres (Supabase)
                            │
                            │ /api/mcp/<segredo>
                            ▼
                    claude.ai (conector remoto)
```

A Evolution API existe porque a **API oficial da Meta não entrega a lista de
contatos nem o histórico de conversas** — ela só vê mensagens a partir do
momento em que você conecta. A conexão por QR Code é o único caminho que
importa o que já existe.

## Ordem de instalação

As quatro etapas dependem uma da outra nesta ordem.

### 1. Banco no Supabase

Crie um projeto em [supabase.com](https://supabase.com) (plano gratuito serve).
No botão **Connect** no topo do painel, copie duas das três opções:

- **Transaction pooler** (porta 6543) → `DATABASE_URL`
- **Session pooler** (porta 5432) → `DIRECT_URL`

Os dois são necessários: o app roda em serverless e precisa do pooler, mas as
migrations não funcionam em modo transaction.

> **Não use a "Direct connection"** (host `db.PROJETO.supabase.co`). Ela é
> IPv6-only no plano gratuito e a maioria das operadoras brasileiras é IPv4 —
> o erro que aparece parece senha errada, mas é falta de rota até o servidor.

Para conferir se as duas estão certas antes de criar as tabelas:

```bash
npm run db:check
```

```bash
cp .env.example .env    # depois preencha DATABASE_URL e DIRECT_URL
npm install
npm run db:migrate      # cria as tabelas
npm run db:seed         # cria os estágios do funil
npm run dev             # http://localhost:3000
```

### 2. Evolution API

Na Railway, junto com o CRM: veja o passo 3a abaixo. Alternativa em VPS
própria: [infra/README.md](infra/README.md) (Docker, um subdomínio,
`docker compose up -d`).

A `AUTHENTICATION_API_KEY` do `infra/.env` precisa ser **idêntica** à
`EVOLUTION_API_KEY` do `.env` do CRM.

### 3. Deploy na Railway

Precisa vir antes de conectar o WhatsApp: o webhook e o conector do Claude
exigem uma URL pública, que localhost não tem.

Um **projeto** na Railway com **dois serviços**: a Evolution API e o CRM. Os
dois ficam de pé 24 h — é isso que permite o "Ao vivo" (as telas atualizam
sozinhas) e o recálculo diário de scores rodar dentro do próprio CRM.

> **Região:** escolha **US West** nos dois serviços (Settings → Region). O banco
> do Supabase está em Oregon; com o servidor do lado, cada consulta leva poucos
> milissegundos em vez dos ~200 ms de quando o CRM roda no Brasil.

#### 3a. Serviço da Evolution API

> **Use a imagem corrigida deste repositório, não a oficial pura.** A
> Evolution 2.3.3 a 2.3.7 tem um defeito que faz as etiquetas e listas
> **pararem de chegar ~5 minutos depois de conectar** (as mensagens
> continuam): ela lê do arquivo a chave das etiquetas com
> `AppStateSyncKeyData.create()`, que a deixa vazia; até o cache de memória
> vencer (5 min) funciona. A correção oficial
> ([PR #2685](https://github.com/evolution-foundation/evolution-api/pull/2685))
> ainda não saiu em nenhuma versão. A pasta `infra/evolution-railway` monta a
> 2.3.7 oficial com essa troca aplicada.
>
> No serviço da Evolution na Railway: **Settings → Source → Connect Repo**
> `8nfinity/crm-resenha-tv`; **Root Directory** `/infra/evolution-railway`;
> **Config-as-code → Railway Config File** `/infra/evolution-railway/railway.json`.
> Variáveis e volume ficam como estão. No log do build deve aparecer
> "Correção da chave das etiquetas aplicada em N arquivos". Ela só é
> reconstruída quando essa pasta muda (publicar o CRM não reinicia a Evolution).

1. **New → GitHub Repo** → `8nfinity/crm-resenha-tv`, com a Root Directory e o
   Config File acima (é a Evolution 2.3.7 oficial + a correção).
2. **Variables** — as mesmas do `.env` da Evolution que roda no seu PC:

   | Variável | Valor |
   |---|---|
   | `SERVER_URL` | o domínio público deste serviço (passo 4) |
   | `AUTHENTICATION_API_KEY` | **idêntica** à `EVOLUTION_API_KEY` do CRM |
   | `DATABASE_PROVIDER` | `postgresql` |
   | `DATABASE_CONNECTION_URI` | a mesma de hoje (schema `evolution_api` no Supabase) |
   | `DATABASE_SAVE_DATA_INSTANCE`, `..._NEW_MESSAGE`, `..._CONTACTS`, `..._CHATS`, `..._LABELS`, `..._HISTORIC` | `true` |
   | `CACHE_REDIS_ENABLED` / `CACHE_LOCAL_ENABLED` | `false` / `true` |

3. **Volume** montado em `/evolution/instances` — **obrigatório para as
   etiquetas e listas**. Na 2.3 a Evolution guarda o login no banco, mas as
   chaves da sessão (entre elas a que abre as etiquetas e listas) ficam em
   arquivos nessa pasta. Sem volume, todo reinício da Evolution (redeploy,
   troca de variável, queda) apaga esses arquivos: o número **continua
   conectado** e as mensagens continuam chegando, mas nenhuma etiqueta, lista
   ou exclusão chega mais — até parear de novo. É o que dá a impressão de que
   "as etiquetas param sozinhas de tempos em tempos".

   Para conferir: no painel do projeto na Railway, o volume aparece preso ao
   serviço da **Evolution** (não ao do CRM); nas configurações dele, o
   *Mount path* precisa ser exatamente `/evolution/instances`. Depois de criar ou corrigir o
   volume, conecte o número de novo (a chave só volta no pareamento).

   Em **Configurações → Etiquetas e listas**, o quadro "O que chegou do
   celular" mostra cada etiquetagem que chegou e o que o CRM fez — é o teste:
   etiquete uma conversa e ela aparece ali em segundos. A linha do tempo da
   conexão mostra as reconexões: uma reconexão sem QR Code seguida de
   etiquetas que não chegam é a Evolution que reiniciou sem o volume.

   > O CRM **nunca escreve** nas etiquetas do WhatsApp. Uma versão antiga
   > "conferia a chave" retirando uma etiqueta inexistente de uma conversa,
   > o que grava uma alteração nos dados da conta — saiu. Etiquetas que param
   > ~5 minutos depois de conectar são o defeito da Evolution do aviso acima.
4. **Settings → Networking → Generate Domain** (porta `8080`).

#### 3b. Serviço do CRM

1. **New → GitHub Repo** → `8nfinity/crm-resenha-tv`. O `railway.json` do repositório
   já diz tudo: build com `npm run build`, migrations (`npm run db:migrate`)
   antes de cada versão entrar no ar, e verificação de saúde em `/api/saude`
   (a versão nova só substitui a antiga se alcançar o banco).
2. **Variables** — todas as do `.env` do CRM:

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL`, `DIRECT_URL` | as mesmas de hoje (Supabase) |
   | `EVOLUTION_API_URL` | `https://<domínio da Evolution do passo 3a>` |
   | `EVOLUTION_API_KEY` | igual à `AUTHENTICATION_API_KEY` da Evolution |
   | `EVOLUTION_INSTANCE`, `WEBHOOK_SECRET`, `MCP_SECRET_PATH` | as mesmas de hoje |
   | `MCP_ALLOWED_CIDRS` | `160.79.104.0/21` |
   | `MCP_DISABLE_IP_CHECK` | **`false`** (é o que tranca o endpoint do Claude) |
   | `TZ` | `America/Sao_Paulo` |
   | `APP_URL` | vazio, ou o domínio próprio se você configurar um |

3. **Settings → Networking → Generate Domain**. O CRM descobre esse endereço
   sozinho (`RAILWAY_PUBLIC_DOMAIN`) e o usa no webhook e em Configurações.

#### 3c. Virada

- Ao subir, o CRM **reaponta o webhook** de todas as contas para o endereço da
  Railway (aparece no log: `Webhook de crm_... → https://...`). Se a instância
  ainda não existir na Evolution nova — o mais provável, porque a sessão do
  WhatsApp ficou na pasta da Evolution do seu PC —, vá em **Conexão → Gerar QR
  Code** e escaneie de novo. As conversas e os leads continuam no banco.
- **Desligue a Evolution e o CRM do PC** (não rode mais o `iniciar.bat`). Duas
  Evolutions com o mesmo número disputam a mesma sessão.

Opcional: com os dois serviços no mesmo projeto, a Evolution pode chamar o CRM
pela rede privada — `WEBHOOK_BASE_URL=http://<serviço-do-crm>.railway.internal:<porta>`.
Comece pelo endereço público, que funciona sem ajuste; troque depois se quiser.

### 4. Conectar o WhatsApp

No CRM publicado, vá em **Conexão** → **Gerar QR Code** → escaneie pelo celular
(WhatsApp → Aparelhos conectados). Isso já configura o webhook sozinho.

Depois, **Carregar conversas** e escolha quem vira lead. Não marque todo mundo:
um funil com a agenda inteira é um funil inútil.

### 5. Conectar o Claude

Em **Configurações** o CRM mostra a URL do conector. No claude.ai:
**Configurações → Conectores → Adicionar conector personalizado**, cole a URL.

Perguntas que funcionam:

- "Quais meus 5 leads mais quentes e por quê?"
- "Quantos leads foram para reunião nos últimos 30 dias?"
- "Quem está parado há mais de duas semanas?"
- "Me dá um relatório completo de follow-ups deste mês"
- "Quem perguntou sobre preço nas conversas?"

## Como o score de temperatura funciona

Cada lead recebe de 0 a 100, somando fatores explicáveis (`lib/scoring.ts`):

| Fator | Peso | Por quê |
|---|---|---|
| Recência da resposta **dele** | 0 a +35 | O sinal mais forte que existe |
| Reciprocidade | 0 a +20 | Diálogo vale mais que monólogo |
| Avanço no funil | 0 a +20 | Quem está em proposta merece mais atenção |
| Valor da oportunidade | 0 a +15 | Só pontua se você preencheu |
| Velocidade de resposta | 0 a +10 | Quem responde rápido está prestando atenção |
| Parado no estágio | −15 a 0 | O único fator negativo |

Cada fator guarda a frase que o explica, e essa frase vai junto para o Claude —
por isso ele consegue dizer *"o João está em 82 porque respondeu ontem e já está
em proposta"* em vez de citar um número que ninguém consegue conferir.

O recálculo acontece a cada mensagem recebida e uma vez por dia, às 6h
(Brasília), agendado pelo próprio servidor (`lib/rotinas.ts`). O diário é
necessário porque a passagem do tempo sozinha esfria um lead: quem respondeu "há
6 dias" hoje respondeu "há 7 dias" amanhã.

## Segurança do endpoint do Claude

O conector não usa OAuth. A porta é trancada por duas coisas (`proxy.ts`):

1. Um segmento secreto e aleatório na URL
2. O IP de origem precisa estar em `160.79.104.0/21`, a faixa de saída publicada
   pela Anthropic

Qualquer recusa devolve **404**, nunca 403 — um 403 confirmaria que existe algo
naquele caminho. Isso é proporcional a um CRM de um usuário só; para um produto
com vários clientes o caminho correto seria OAuth 2.1 com DCR.

Se a Anthropic mudar a faixa de saída, o sintoma é o conector parar de
funcionar. O log de `proxy.ts` registra o IP recusado, que é o que aponta a causa.

## Migrations: nunca use `prisma migrate dev`

Este projeto tem dados reais no banco desde o primeiro dia. O `migrate dev` é um
comando de desenvolvimento: quando detecta divergência entre o schema e o banco,
ele **reseta o banco inteiro** e roda o seed de novo. Já aconteceu aqui — levou
2155 contatos e 62 leads.

O fluxo seguro:

```bash
# 1. edite prisma/schema.prisma
# 2. gere o SQL comparando schema e banco (nao toca em nada)
npm run db:migrate:criar > prisma/migrations/AAAAMMDDHHMMSS_nome/migration.sql
# 3. LEIA o SQL. Se houver DROP ou coluna obrigatoria nova, ajuste a mao
#    para preservar os dados existentes.
# 4. aplique
npm run db:migrate
```

O `db:migrate` é `prisma migrate deploy`, que só aplica o que existe e nunca
reseta.

**Depois de toda migration, reinicie o `npm run dev`.** O cliente do Prisma fica
em cache no `globalThis` durante o desenvolvimento, então o servidor continua
usando a versão antiga e qualquer tabela nova aparece como `undefined` — o erro
que você vê é `Cannot read properties of undefined (reading 'findFirst')`, que
não sugere em nada a causa real.

Se uma rota nova responder 404 mesmo existindo, apague `.next` e rode de novo: o
cache de tipos do Next corrompe quando rotas são criadas ou removidas.

## Etiquetas de atendente e histórico de etiquetas

Em Configurações → Etiquetas, escolha **“👤 Atendente”** para as etiquetas com
o nome de quem atende (ex.: “João”, “Maria”). Ela não atribui o lead a ninguém:
só registra no histórico quem atendeu. Etiquetar a conversa com “João” e depois
com “Maria” deixa no histórico do lead:

- João atendeu o lead
- Maria atendeu o lead — *Atendimento passou de João para Maria*

Toda etiqueta aplicada ou retirada (de qualquer tipo) fica no histórico do
lead, na aba **Notas**, junto das anotações, com data e hora.

## Notificações no aparelho (lembretes)

Cada pessoa abre o CRM no computador e no celular e clica em **Ativar
notificações** (na tela Hoje ou em Configurações → Minha conta). A partir daí:

- **Lembrete** `AVISO_MINUTOS_ANTES` minutos antes de cada atividade (padrão
  30), para quem marcou (sem autor, para os administradores) — com o número do
  follow-up: “2º follow-up: Ligar às 14:30”.
- **Resumo do dia** às `AVISO_HORA_RESUMO` h (padrão 7).

Não precisa configurar nada: as chaves de envio (VAPID) são geradas pelo
próprio CRM e guardadas no banco. Funciona no Chrome, Edge e Firefox (computador
e Android). No iPhone, só com o CRM adicionado à Tela de Início (Safari →
Compartilhar → Adicionar à Tela de Início), iOS 16.4 ou mais novo.

## Avisos por e-mail (opcional)

Com `BREVO_API_KEY` (sem domínio próprio: o remetente pode ser seu Gmail) ou
`RESEND_API_KEY` (com domínio próprio), mais `EMAIL_REMETENTE` (veja
`.env.example`). Cada conta do CRM recebe no próprio e-mail de login:

- **Lembrete** `AVISO_MINUTOS_ANTES` minutos antes de cada atividade marcada
  (padrão 30). Vai para quem marcou a atividade (sem autor, para os
  administradores).
- **Resumo do dia** às `AVISO_HORA_RESUMO` h (padrão 7): o que vence hoje e o
  que está atrasado. Vendedor recebe o dele; administradores, o do time.

Cada pessoa liga ou desliga os e-mails em Configurações → Minha conta. Em
Configurações → Avisos por e-mail há um botão de teste.

## Playbook em e-book

No Playbook, “Enviar e-book (PDF)” (administradores) sobe um arquivo de até
25 MB. Ele abre dentro do CRM como um livro — capa, depois duas páginas lado a
lado (uma no celular) — e vira página pelas setas, pelo teclado, tocando na
metade do livro ou arrastando o dedo; tem tela cheia e lembra onde cada pessoa
parou. A busca do playbook acha o texto de dentro do e-book. PDF digitalizado
(só imagem) abre normalmente, mas não entra na busca pelo conteúdo.

O leitor usa o pdf.js, servido pelo próprio CRM: `npm run dev` e
`npm run build` copiam os arquivos para `public/pdfjs` sozinhos.

## Follow-ups numerados

Cada follow-up do lead mostra a ordem dele — 1º, 2º, 3º… — no painel do lead,
no calendário e na tela Hoje. A ordem é a da data do follow-up (o prazo, ou
quando foi feito): um follow-up marcado para antes de outro entra na frente.
Ao agendar, o painel avisa “Este será o 3º follow-up deste lead”.

## Comandos

```bash
npm run dev           # desenvolvimento
npm run build         # build de produção
npm run test          # testes de score e da trava de IP
npm run db:studio     # inspecionar o banco
npm run db:migrate    # aplicar migrations pendentes (nunca reseta)
npm run score:recalc  # recalcular scores na mão
```

## O que este MVP não faz

- **Não envia mensagens.** Você continua respondendo pelo WhatsApp normal. É
  também o que mais reduz o risco de bloqueio.
- **Não importa a conta inteira.** O WhatsApp entrega a um aparelho novo apenas
  o histórico recente (tipicamente alguns meses). Conversas antigas demais não
  vêm, e não há contorno para isso.
- **O Claude não altera nada.** As sete ferramentas são somente leitura: ele
  analisa e recomenda, você move os cards.

## Sobre o risco de bloqueio

A conexão por QR Code usa o protocolo do WhatsApp Web, o que contraria os termos
de uso da Meta. Uso como CRM pessoal raramente gera bloqueio; disparo em massa
gera.

Se quiser migrar para a API oficial, a mudança fica contida em `lib/evolution/`.
O que se perde é justamente a importação de contatos e histórico — a API oficial
não oferece nenhuma das duas.

## Segurança

O CRM fica na internet, então a proteção é em camadas — nenhuma depende de
uma só barreira:

| Camada | Como |
|---|---|
| Login | Tudo exige login (`proxy.ts`). Senhas com scrypt; sessão em cookie assinado (HMAC), `HttpOnly`, `Secure` quando hospedado, 7 dias. Trava de 5 erros por e-mail e 20 por IP. |
| Papéis | **Master** gerencia todo mundo e ninguém mexe na conta dele; **Administrador** configura o CRM e gerencia vendedores; **Vendedor** trabalha os leads. A regra fica em `lib/auth/papeis.ts` e no `proxy.ts`, e as rotas sensíveis conferem de novo. |
| Sessões | Desativar alguém, trocar senha ou mudar o papel derruba as sessões abertas daquela conta em até 30 s. |
| CSRF | Cookie `SameSite=Lax` + recusa de qualquer alteração vinda de outra origem. |
| Navegador | CSP (só scripts do próprio CRM), anti-iframe, HSTS, `nosniff`, sem `X-Powered-By`. |
| Banco | Conexão criptografada (TLS). Com `DATABASE_CA_CERT`, também autenticada. |
| Integrações | Webhook com segredo no header (comparação em tempo constante); conector do Claude com segmento secreto + faixa de IP da Anthropic. |

Primeiro acesso: `npm run usuario:criar` no computador, ou as variáveis
`ADMIN_EMAIL` / `ADMIN_NOME` / `ADMIN_SENHA` na hospedagem (só valem com o banco
sem nenhum usuário — apague a senha depois).
