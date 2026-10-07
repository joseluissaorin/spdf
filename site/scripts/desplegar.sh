#!/bin/sh
# Construye y despliega la web de SPDF (https://spdf.joseluissaorin.com).
# Hace, en orden: spdf-format (js/), la build web del lector (reader/), la web
# (site/), sus pruebas, y el despliegue del Worker con sus assets. Para si algo falla.
#   site/scripts/desplegar.sh            (con el estado del CI leído con gh)
#   SPDF_SIN_RED=1 site/scripts/desplegar.sh
set -eu
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
export CLOUDFLARE_ACCOUNT_ID=f22c7a728ddc8e41cefd2644f8fb7632

echo "== spdf-format (js)"
(cd "$RAIZ/js" && npm ci --silent && npm run build --silent)

echo "== lector web (reader)"
if [ -f "$RAIZ/reader/package.json" ] && grep -q '"build:web"' "$RAIZ/reader/package.json"; then
  (cd "$RAIZ/reader" && npm ci --silent && npm run build:web --silent)
else
  echo "   sin build web del lector: se publica la hoja provisional"
fi

echo "== complemento de Zotero (integrations/zotero)"
if [ -f "$RAIZ/integrations/zotero/package.json" ]; then
  (cd "$RAIZ/integrations/zotero" && npm ci --silent && npm run build --silent)
fi

echo "== web"
cd "$RAIZ/site"
npm ci --silent
npm run build
npm test

echo "== despliegue"
npx wrangler deploy

echo "== comprobación"
for r in / /es /spec /validator /llms.txt /sitemap.xml /reader/; do
  printf '%-14s ' "$r"
  curl -s -o /dev/null -w '%{http_code}\n' -H 'Accept: text/html' "https://spdf.joseluissaorin.com$r"
done
printf 'curl a la raíz: '; curl -s https://spdf.joseluissaorin.com/ | head -3 | tr '\n' ' '; echo
