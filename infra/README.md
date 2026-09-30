# Evolution API na VPS

O serviço que fala com o WhatsApp. Roda separado do CRM porque a sessão do
WhatsApp é uma conexão viva — precisa de um processo que nunca dorme.

## O que você precisa antes

- Uma VPS com pelo menos 2 GB de RAM e Docker instalado (Hostinger, Contabo,
  DigitalOcean — qualquer uma serve, ~R$ 35/mês)
- Um domínio ou subdomínio apontando para o IP da VPS (registro **A** no DNS)

O plano gratuito de serviços que hibernam não funciona aqui: quando o container
dorme, a sessão do WhatsApp cai e você precisa escanear o QR de novo.

## Instalação

```bash
# na VPS, como root ou com sudo
git clone <seu-repositorio> crm
cd crm/infra

cp .env.example .env
nano .env        # preencha DOMAIN, SERVER_URL, as duas senhas

docker compose up -d
docker compose logs -f evolution   # acompanhe até subir
```

Gere as senhas com:

```bash
openssl rand -hex 24
```

A `AUTHENTICATION_API_KEY` daqui precisa ser **idêntica** à `EVOLUTION_API_KEY`
no `.env` do CRM. É o erro mais comum: o CRM devolve 401 e parece que a VPS está
fora do ar.

## Verificando

```bash
curl https://SEUDOMINIO/instance/fetchInstances \
  -H "apikey: SUA_AUTHENTICATION_API_KEY"
```

Uma resposta JSON (mesmo que lista vazia) significa que está tudo funcionando.
Se der erro de certificado, o DNS ainda não propagou — espere e tente de novo.

## Criando a instância

Pelo painel, em `https://SEUDOMINIO/manager`, ou pela API:

```bash
curl -X POST https://SEUDOMINIO/instance/create \
  -H "apikey: SUA_AUTHENTICATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"instanceName":"crm","integration":"WHATSAPP-BAILEYS"}'
```

O nome `crm` precisa bater com `EVOLUTION_INSTANCE` no `.env` do CRM.

Depois disso, o QR Code sai pela tela **Conexão** do próprio CRM — que também
configura o webhook automaticamente, passo que é fácil esquecer fazendo na mão.

## Manutenção

```bash
docker compose logs -f evolution    # ver o que está acontecendo
docker compose restart evolution    # reiniciar sem perder a sessão
docker compose pull && docker compose up -d   # atualizar
```

A sessão do WhatsApp vive em `./data/evolution_instances`. **Não apague essa
pasta** — apagar força um novo pareamento por QR Code.

## Sobre o risco

Esta conexão usa o protocolo do WhatsApp Web por baixo, o que contraria os
termos de uso da Meta. Uso como CRM pessoal raramente gera bloqueio; disparo em
massa gera. O CRM é somente leitura de propósito — ele não envia nada.

Se o bloqueio preocupar, a troca para a API oficial da Meta mexe só em
`lib/evolution/`, sem tocar no resto do CRM. O que se perde nessa troca é a
importação de contatos e histórico, que a API oficial não oferece.
