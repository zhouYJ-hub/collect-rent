#!/usr/bin/env bash
# 一键发布到 GitHub Pages（需已安装依赖，并已配置 git 远程仓库）
set -euo pipefail
cd "$(dirname "$0")"

npm run build
npx gh-pages -d dist -t true

echo "✅ 已发布到 gh-pages 分支"
echo "   请到仓库 Settings → Pages，选择 Branch: gh-pages，目录: /(root)"
