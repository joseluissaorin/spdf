#!/bin/sh
# Compila la IPA de iOS con firma automática del equipo y la sube a App Store Connect
# (TestFlight, pruebas internas; no la envía a revisión). Requisito previo: la ficha de la
# app «Lector SPDF» (bundle id com.joseluissaorin.lectorspdf) creada a mano en App Store
# Connect: la API no permite crearla. La clave de la API vive en
# ~/.appstoreconnect/private_keys/ (nunca en el repositorio).
set -eu
cd "$(dirname "$0")/.."
KEY_ID=4HVB5YWGWD
ISSUER=1e05b19d-c430-4408-8af5-24d6623959c4
export APPLE_API_KEY=$KEY_ID APPLE_API_ISSUER=$ISSUER APPLE_API_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_$KEY_ID.p8"
# El xattr de Miniconda no sirve para empaquetar: el del sistema delante.
PATH="/usr/bin:$PATH" npx tauri ios build --export-method app-store-connect --build-number "$(date +%Y%m%d%H%M)"
IPA="src-tauri/gen/apple/build/arm64/Lector SPDF.ipa"
xcrun altool --upload-app -f "$IPA" -t ios --apiKey "$KEY_ID" --apiIssuer "$ISSUER"
echo "Subida. Aparece en TestFlight (pruebas internas) cuando Apple termine de procesarla."
