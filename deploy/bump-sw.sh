#!/usr/bin/env bash
# Atualiza a versão do cache do service worker (sw.js) para forçar os navegadores
# a baixarem a versão nova após um deploy. Rode ANTES de commitar mudanças de conteúdo.
# Uso: ./deploy/bump-sw.sh
set -euo pipefail
cd "$(dirname "$0")/.."

NOVA="ubs-toledo-$(date +%Y%m%d-%H%M%S)"
# Substitui o valor de VERSAO em sw.js
sed -i.bak -E "s/(const VERSAO = \")[^\"]+(\";)/\1${NOVA}\2/" sw.js
rm -f sw.js.bak
# Mantém o APP_VERSION (rodapé) em sincronia com a VERSAO do service worker.
sed -i.bak -E "s/(const APP_VERSION = \")[^\"]+(\";)/\1${NOVA}\2/" js/app.js
rm -f js/app.js.bak
echo "sw.js VERSAO + js/app.js APP_VERSION -> ${NOVA}"
