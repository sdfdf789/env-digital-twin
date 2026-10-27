#!/usr/bin/env bash
# 使用 Git Credential Manager 已存储的 GitHub 凭据，创建仓库 -> 推送 -> 开启 GitHub Pages
set -euo pipefail

REPO_NAME="${1:-env-digital-twin}"
DESC="环境监测数字孪生三维可视化大屏 · Three.js + ECharts · 蓝色科幻风格中国 3D 地图"
API="https://api.github.com"

# ---------- 1. 读取凭据（GCM 已存于 Windows 凭据管理器） ----------
CRED="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill)"
TOKEN="$(printf '%s\n' "$CRED" | sed -n 's/^password=//p')"
USERNAME="$(printf '%s\n' "$CRED" | sed -n 's/^username=//p')"

if [ -z "$TOKEN" ]; then echo "✗ 未取到令牌，请先完成浏览器授权"; exit 1; fi
echo "✓ 已取到凭据，账号：$USERNAME"

api() { # api METHOD PATH [JSON]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" \
      -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" \
      -H "Content-Type: application/json" -d "$body" "$API$path"
  else
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" \
      -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "$API$path"
  fi
}

# ---------- 2. 创建仓库（幂等） ----------
echo "→ 创建仓库 $USERNAME/$REPO_NAME ..."
RESP="$(api POST /user/repos "{\"name\":\"$REPO_NAME\",\"description\":\"$DESC\",\"private\":false,\"has_issues\":true,\"has_wiki\":false,\"auto_init\":false}")"
if printf '%s' "$RESP" | grep -q '"full_name"'; then
  echo "✓ 仓库已创建"
else
  echo "  已存在或创建失败，继续尝试使用：$(printf '%s' "$RESP" | head -c 300)"
fi

# ---------- 3. 推送 main ----------
cd "$(dirname "$0")"
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$USERNAME/$REPO_NAME.git"
echo "→ 推送 main ..."
git push -u origin main 2>&1 | tail -5

# ---------- 4. 开启 GitHub Pages（main 分支根目录） ----------
echo "→ 开启 GitHub Pages ..."
PRESP="$(api POST /repos/$USERNAME/$REPO_NAME/pages '{"source":{"branch":"main","path":"/"}}')"
if printf '%s' "$PRESP" | grep -q '"html_url"'; then
  echo "✓ Pages 已开启"
else
  echo "  启用返回：$(printf '%s' "$PRESP" | head -c 300)"
fi

# ---------- 5. 轮询构建状态 ----------
URL="https://$USERNAME.github.io/$REPO_NAME/"
echo "→ 等待首次构建 ..."
for i in $(seq 1 30); do
  ST="$(api GET /repos/$USERNAME/$REPO_NAME/pages 2>/dev/null | sed -n 's/.*"status":"\([a-z]*\)".*/\1/p' | head -1 || true)"
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$URL" || true)"
  echo "  [$i] status=${ST:-pending} http=${CODE:-timeout}"
  if [ "$CODE" = "200" ]; then echo "✓ 已上线：$URL"; break; fi
  sleep 8
done

echo "站点地址：$URL"
