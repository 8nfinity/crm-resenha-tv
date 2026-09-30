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

### 2. Evolution API na VPS

Passo a passo completo em [infra/README.md](infra/README.md). Resumo: VPS com
Docker, um subdomínio apontando para ela, `docker compose up -d`.

A `AUTHENTICATION_API_KEY` do `infra/.env` precisa ser **idêntica** à
`EVOLUTION_API_KEY` do `.env` do CRM.

### 3. Deploy na Vercel

Precisa vir antes de conectar o WhatsApp: o webhook e o conector do Claude
exigem uma URL pública, que localhost não tem.

```bash
npx vercel
```

Variáveis de ambiente a configurar na Vercel — todas as do `.env`, mais:

| Variável | Valor |
|---|---|
| `MCP_DISABLE_IP_CHECK` | **`false`** (é o que tranca o endpoint) |
| `CRON_SECRET` | `openssl rand -hex 32` |

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

O recálculo acontece a cada mensagem recebida e num cron diário às 9h. O cron é
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
