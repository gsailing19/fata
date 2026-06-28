#!/bin/bash
# fata deploy script — copies only public files to dist/, then deploys
set -e

rm -rf dist
mkdir -p dist/modules dist/logo

# HTML
cp index.html about.html privacy.html privacy-en.html dist/

# JS modules (all 6 are public-facing browser code)
cp modules/*.js dist/modules/

# Assets
cp manifest.json robots.txt dist/
cp logo/logo.svg logo/logo-unified-v2.png logo/logo-horizontal.svg dist/logo/ 2>/dev/null || true

# Cloudflare Pages config
cp _redirects dist/
cp _headers dist/

CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN}" \
  npx wrangler pages deploy dist --project-name=fata --branch=main --commit-dirty=true
