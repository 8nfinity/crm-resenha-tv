#!/usr/bin/env bash
#
# Instalação da Evolution API numa e2-micro do Google Cloud (free tier, 1 GB RAM).
#
# Cole este script inteiro no terminal SSH da instância (botão "SSH" no painel
# do Compute Engine). Ele é idempotente: rodar de novo não estraga nada.
#
# O script é autossuficiente — escreve o docker-compose e o Caddyfile por conta
# própria. É de propósito: com uma cópia só, não há risco de o arquivo do
# repositório e o do servidor divergirem sem ninguém perceber.

set -euo pipefail

VERDE=$'\033[32m'; AMAR=$'\033[33m'; VERM=$'\033[31m'; CINZA=$'\033[90m'; R=$'\033[0m'
passo() { echo; echo "${VERDE}==>${R} $1"; }
aviso() { echo "${AMAR}[aviso]${R} $1"; }
erro()  { echo "${VERM}[erro]${R} $1" >&2; }

DIR=/opt/evolution

if [[ $EUID -ne 0 ]]; then
  erro "Rode como root: sudo bash $0"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
passo "Conferindo a máquina"

RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
echo "    RAM: ${RAM_MB} MB"
if [[ $RAM_MB -lt 900 ]]; then
  aviso "Menos RAM que o esperado numa e2-micro. Pode ficar instável."
fi

ARCH=$(uname -m)
echo "    Arquitetura: ${ARCH}"

# ─────────────────────────────────────────────────────────────────────────────
passo "Criando swap de 2 GB"

# Em 1 GB de RAM o swap não é luxo: é o que impede o kernel de matar a Evolution
# num pico de sincronização de histórico. swappiness baixo faz o sistema usá-lo
# só quando realmente faltar memória, em vez de trocar páginas por hábito.
if [[ -f /swapfile ]]; then
  echo "    swap já existe, pulando"
else
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "    2 GB criados"
fi

sysctl -q -w vm.swappiness=10
grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf

# ─────────────────────────────────────────────────────────────────────────────
passo "Instalando Docker"

if command -v docker >/dev/null 2>&1; then
  echo "    já instalado: $(docker --version)"
else
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null

  install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null
  echo "    instalado: $(docker --version)"
fi

# Sem limite, o journal do Docker enche os 30 GB de disco em alguns meses.
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
systemctl restart docker

# ─────────────────────────────────────────────────────────────────────────────
passo "Coletando a configuração"

mkdir -p "$DIR"
cd "$DIR"

if [[ -f .env ]]; then
  echo "    .env já existe, reaproveitando"
  # shellcheck disable=SC1091
  source .env
else
  echo
  echo "    Qual o domínio desta máquina?"
  echo "    ${CINZA}Ex: seunome.duckdns.org (crie grátis em duckdns.org)${R}"
  echo "    ${CINZA}Ele precisa JÁ estar apontando para o IP desta VM,${R}"
  echo "    ${CINZA}senão o Caddy não consegue emitir o certificado.${R}"
  echo
  read -rp "    Domínio: " DOMAIN

  if [[ -z "${DOMAIN}" ]]; then
    erro "Domínio é obrigatório."
    exit 1
  fi

  # O IP externo da e2-micro é efêmero: se o Google reiniciar a VM numa
  # manutenção, ele muda e o domínio passa a apontar para o nada — sem aviso
  # nenhum. O token do DuckDNS permite reapontar sozinho a cada 5 minutos.
  DUCKDNS_TOKEN=""
  if [[ "${DOMAIN}" == *.duckdns.org ]]; then
    echo
    echo "    Token do DuckDNS ${CINZA}(aparece no topo de duckdns.org)${R}"
    echo "    ${CINZA}Serve para reapontar o domínio sozinho se o IP mudar.${R}"
    echo "    ${CINZA}Pode deixar em branco, mas aí o IP vira manutenção sua.${R}"
    read -rp "    Token: " DUCKDNS_TOKEN
  fi

  AUTHENTICATION_API_KEY=$(openssl rand -hex 24)
  POSTGRES_PASSWORD=$(openssl rand -hex 24)

  cat > .env <<EOF
DOMAIN=${DOMAIN}
SERVER_URL=https://${DOMAIN}
AUTHENTICATION_API_KEY=${AUTHENTICATION_API_KEY}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DUCKDNS_TOKEN=${DUCKDNS_TOKEN}
EOF
  chmod 600 .env
  echo "    .env criado"
fi

# ─────────────────────────────────────────────────────────────────────────────
if [[ -n "${DUCKDNS_TOKEN:-}" ]]; then
  passo "Configurando a atualização automática de DNS"

  SUB="${DOMAIN%%.duckdns.org}"
  cat > /usr/local/bin/duckdns-update <<EOF
#!/bin/sh
# Reaponta ${DOMAIN} para o IP atual desta VM. O parâmetro ip vazio faz o
# DuckDNS detectar o IP de origem da requisição sozinho.
curl -fsS --max-time 20 \\
  "https://www.duckdns.org/update?domains=${SUB}&token=${DUCKDNS_TOKEN}&ip=" \\
  >> /var/log/duckdns.log 2>&1
EOF
  chmod 700 /usr/local/bin/duckdns-update
  /usr/local/bin/duckdns-update || aviso "A primeira atualização falhou — confira o token."

  # A cada 5 minutos e também no boot, que é justamente quando o IP muda.
  cat > /etc/cron.d/duckdns <<'CRON'
*/5 * * * * root /usr/local/bin/duckdns-update
@reboot root sleep 30 && /usr/local/bin/duckdns-update
CRON
  chmod 644 /etc/cron.d/duckdns
  echo "    DNS será reapontado sozinho se o IP mudar"
fi

# ─────────────────────────────────────────────────────────────────────────────
passo "Conferindo o DNS"

IP_PUBLICO=$(curl -fsS --max-time 10 https://api.ipify.org || echo "")
IP_DOMINIO=$(getent hosts "${DOMAIN}" 2>/dev/null | awk '{print $1}' | head -1 || echo "")

echo "    IP desta VM:     ${IP_PUBLICO:-?}"
echo "    IP do domínio:   ${IP_DOMINIO:-não resolve}"

if [[ -z "$IP_DOMINIO" ]]; then
  aviso "O domínio não resolve ainda. O Caddy vai falhar ao emitir o certificado."
  aviso "Aponte o domínio para ${IP_PUBLICO} e rode este script de novo."
elif [[ "$IP_DOMINIO" != "$IP_PUBLICO" ]]; then
  aviso "O domínio aponta para outro IP. Corrija antes de continuar."
else
  echo "    ${VERDE}DNS correto${R}"
fi

# ─────────────────────────────────────────────────────────────────────────────
passo "Escrevendo docker-compose.yml"

cat > docker-compose.yml <<'YAML'
# Evolution API em 1 GB de RAM.
#
# Sem Redis (cache em memória) e com o Postgres apertado: os padrões dele
# assumem um servidor dedicado e sozinhos comeriam metade da máquina.
# Os limites por container existem para que um vazamento na Evolution não
# derrube o Postgres junto — perder o banco significa perder a sessão.

services:
  evolution:
    image: evoapicloud/evolution-api:latest
    restart: always
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      SERVER_URL: ${SERVER_URL}
      AUTHENTICATION_API_KEY: ${AUTHENTICATION_API_KEY}

      DATABASE_ENABLED: "true"
      DATABASE_PROVIDER: postgresql
      DATABASE_CONNECTION_URI: postgresql://evolution:${POSTGRES_PASSWORD}@postgres:5432/evolution
      DATABASE_SAVE_DATA_INSTANCE: "true"
      DATABASE_SAVE_DATA_NEW_MESSAGE: "true"
      DATABASE_SAVE_MESSAGE_UPDATE: "true"
      DATABASE_SAVE_DATA_CONTACTS: "true"
      DATABASE_SAVE_DATA_CHATS: "true"
      DATABASE_SAVE_DATA_LABELS: "false"
      DATABASE_SAVE_DATA_HISTORIC: "true"

      CACHE_REDIS_ENABLED: "false"
      CACHE_LOCAL_ENABLED: "true"

      WEBHOOK_GLOBAL_ENABLED: "false"

      CONFIG_SESSION_PHONE_CLIENT: CRM
      CONFIG_SESSION_PHONE_NAME: Chrome
      QRCODE_LIMIT: "10"
      LOG_LEVEL: ERROR
      DEL_INSTANCE: "false"

      # Teto do heap do Node abaixo do limite do container: o garbage collector
      # age antes de o kernel matar o processo por falta de memória.
      NODE_OPTIONS: "--max-old-space-size=380"
    volumes:
      - ./data/evolution_instances:/evolution/instances
    expose:
      - "8080"
    mem_limit: 460m

  postgres:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: evolution
    command: >
      postgres
      -c shared_buffers=48MB
      -c effective_cache_size=256MB
      -c maintenance_work_mem=32MB
      -c work_mem=2MB
      -c max_connections=20
      -c wal_buffers=2MB
      -c max_wal_size=512MB
      -c min_wal_size=128MB
      -c random_page_cost=1.1
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U evolution -d evolution"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s
    mem_limit: 220m

  caddy:
    image: caddy:2-alpine
    restart: always
    depends_on:
      - evolution
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./data/caddy_data:/data
      - ./data/caddy_config:/config
    environment:
      DOMAIN: ${DOMAIN}
    mem_limit: 64m
YAML

cat > Caddyfile <<'CADDY'
{$DOMAIN} {
	# HTTPS automático via Let's Encrypt. Só funciona com o DNS já apontado.
	reverse_proxy evolution:8080

	# O painel da Evolution e o QR Code não deveriam aparecer em buscador.
	header {
		X-Robots-Tag "noindex, nofollow"
		-Server
	}

	encode gzip
}
CADDY

mkdir -p data/evolution_instances data/postgres data/caddy_data data/caddy_config

# ─────────────────────────────────────────────────────────────────────────────
passo "Subindo os serviços"

docker compose pull -q
docker compose up -d

echo "    aguardando a Evolution responder..."
OK=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 http://localhost:8080 >/dev/null 2>&1; then OK=1; break; fi
  sleep 3
done

# ─────────────────────────────────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════"
if [[ $OK -eq 1 ]]; then
  echo "${VERDE} Evolution API no ar${R}"
else
  echo "${AMAR} Os containers subiram, mas a API ainda não respondeu.${R}"
  echo " Veja o que houve com:  docker compose -f ${DIR}/docker-compose.yml logs evolution"
fi
echo "════════════════════════════════════════════════════════"
echo
echo " Cole estes valores no .env do CRM, na sua máquina:"
echo
echo "   EVOLUTION_API_URL=\"https://${DOMAIN}\""
echo "   EVOLUTION_API_KEY=\"${AUTHENTICATION_API_KEY}\""
echo "   EVOLUTION_INSTANCE=\"crm\""
echo
echo " ${CINZA}Memória em uso agora:${R}"
free -h | awk '/^Mem:|^Swap:/{printf "   %-6s usado %-6s de %s\n", $1, $3, $2}'
echo
echo " ${CINZA}Comandos úteis (rode dentro de ${DIR}):${R}"
echo "   docker compose ps                 ver o estado"
echo "   docker compose logs -f evolution  acompanhar os logs"
echo "   docker compose restart evolution  reiniciar sem perder a sessão"
echo "   docker stats --no-stream          ver consumo de memória"
echo
