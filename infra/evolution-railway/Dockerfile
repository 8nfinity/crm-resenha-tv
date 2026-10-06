# Evolution API 2.3.7 oficial + correção da chave das etiquetas.
#
# O defeito (Evolution 2.3.3 a 2.3.7, sem versão corrigida até 05/10/2026):
# ao ler do arquivo a chave que abre as etiquetas e listas, ela usa
# AppStateSyncKeyData.create(), que deixa a chave como TEXTO em vez de bytes
# — vira uma chave vazia. Nos primeiros 5 minutos depois de conectar funciona,
# porque a chave certa ainda está num cache de memória; quando o cache vence,
# nenhuma etiqueta consegue mais ser lida e elas param de chegar (as mensagens
# continuam). Reproduzido com a Baileys da própria Evolution.
#
# A correção é a do PR oficial #2685 (evolution-foundation/evolution-api):
# .create( → .fromObject( nos três leitores de chave. Aqui ela é aplicada no
# código já compilado da imagem oficial, sem mudar mais nada. Quando sair uma
# versão com a correção, troque por ela e apague esta pasta.

FROM evoapicloud/evolution-api:v2.3.7

# (grep devolve "falha" nos arquivos sem a linha: o "|| true" evita que isso
# derrube o build; a conferência de verdade vem logo depois.)
RUN set -eu; \
    arquivos="$(find /evolution/dist \( -name '*.js' -o -name '*.mjs' \) -exec grep -l 'AppStateSyncKeyData.create(' {} + || true)"; \
    [ -n "$arquivos" ] || { echo 'Não achei AppStateSyncKeyData.create( na imagem: a correção não se aplica a esta versão.'; exit 1; }; \
    sed -i 's/AppStateSyncKeyData\.create(/AppStateSyncKeyData.fromObject(/g' $arquivos; \
    sobrou="$(find /evolution/dist \( -name '*.js' -o -name '*.mjs' \) -exec grep -l 'AppStateSyncKeyData.create(' {} + || true)"; \
    [ -z "$sobrou" ] || { echo "Sobrou AppStateSyncKeyData.create( em: $sobrou"; exit 1; }; \
    node --check /evolution/dist/main.js; \
    echo "Correção da chave das etiquetas aplicada em $(echo "$arquivos" | wc -l) arquivos."
