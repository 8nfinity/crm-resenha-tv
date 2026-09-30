# Evolution API no Google Cloud (free tier)

Instalação numa `e2-micro` sempre-gratuita. Custo: **R$ 0**, com as ressalvas
do fim deste arquivo.

A configuração aqui é diferente da de [../README.md](../README.md) porque a
e2-micro tem só **1 GB de RAM**: sem Redis, Postgres apertado e limite de
memória por container.

---

## 1. Conta no Google Cloud

[console.cloud.google.com](https://console.cloud.google.com) — exige cartão de
crédito para verificação. Você ganha US$ 300 em créditos por 90 dias, além do
free tier permanente.

> **Antes dos 90 dias acabarem, faça upgrade para conta paga.** Se o trial
> encerrar sem upgrade, os recursos são parados e podem ser perdidos — inclusive
> a instância sempre-gratuita. O upgrade não cobra nada enquanto o uso ficar
> dentro dos limites do free tier.

## 2. Criar a instância

Compute Engine → **Criar instância**. Os campos que importam:

| Campo | Valor | Por quê |
|---|---|---|
| Região | **us-west1** (Oregon) | Uma das três gratuitas, e a mais perto do seu Supabase |
| Tipo de máquina | **e2-micro** | A única no free tier |
| Disco de inicialização | **Debian 12**, **Standard persistent disk**, **30 GB** | SSD é cobrado; balanced também. Só o *standard* é gratuito |
| Firewall | marque **Permitir tráfego HTTP** e **HTTPS** | Sem isso o Caddy não emite o certificado |

Qualquer outra região, tipo de máquina ou tipo de disco **sai do free tier e é
cobrado**. Confira antes de criar.

## 3. Domínio gratuito

Em [duckdns.org](https://duckdns.org), entre com Google ou GitHub, crie um
subdomínio e aponte para o IP externo da instância (aparece na lista de VMs).

Copie também o **token** que aparece no topo da página — o script usa para
reapontar o domínio sozinho caso o IP mude.

> O IP da e2-micro é efêmero: numa manutenção do Google ele muda, e sem o token
> o domínio passa a apontar para o nada sem aviso nenhum.

## 4. Instalar

Na lista de VMs, botão **SSH** (abre um terminal no navegador). Cole:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/SEU-USUARIO/SEU-REPO/main/infra/gcp/setup.sh)"
```

Ou, se o repositório ainda não estiver no GitHub: abra o `setup.sh`, copie o
conteúdo inteiro, e no terminal SSH rode `sudo nano /tmp/setup.sh`, cole, salve
com `Ctrl+O` `Enter` `Ctrl+X`, e execute com `sudo bash /tmp/setup.sh`.

O script pede o domínio e o token, e faz o resto: swap de 2 GB, Docker,
Postgres ajustado, Evolution, Caddy com HTTPS e o atualizador de DNS.

Ao final ele imprime os três valores para colar no `.env` do CRM.

## 5. Criar a instância do WhatsApp

```bash
curl -X POST https://SEUDOMINIO/instance/create \
  -H "apikey: SUA_CHAVE" \
  -H "Content-Type: application/json" \
  -d '{"instanceName":"crm","integration":"WHATSAPP-BAILEYS"}'
```

O nome `crm` precisa bater com `EVOLUTION_INSTANCE` no `.env` do CRM.

Daí em diante o QR Code sai pela tela **Conexão** do próprio CRM.

---

## Manutenção

```bash
cd /opt/evolution
docker compose ps                 # estado dos serviços
docker compose logs -f evolution  # acompanhar
docker stats --no-stream          # consumo de memória
free -h                           # RAM e swap
```

**Vigie a memória nas primeiras semanas.** Se o swap passar de ~500 MB em uso
constante, a máquina está apertada demais e vale migrar para a Oracle Cloud
(2 OCPU / 12 GB, também gratuita) ou para uma VPS paga.

## As ressalvas do free tier

- **1 GB de egress por mês.** Depois disso, ~US$ 0,12/GB. O uso normal (webhooks
  e importação) fica bem abaixo, mas não é ilimitado.
- **1 GB de RAM.** Cabe, com folga pequena. O swap é rede de segurança, não
  espaço de trabalho.
- **Upgrade obrigatório** para conta paga antes dos 90 dias, como dito acima.
- **Só us-west1, us-central1 e us-east1** são gratuitas.
