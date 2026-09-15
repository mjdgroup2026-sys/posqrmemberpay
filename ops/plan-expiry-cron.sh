#!/usr/bin/env bash
#
# plan-expiry-cron.sh — ยิง route เตือนแพ็กเกจใกล้หมดอายุของแอป (Phase 14b) วันละครั้งจาก cron
#
# แอปไม่มี scheduler ในตัว — งานนี้แค่เรียก GET /api/cron/plan-expiry/<CRON_SECRET> ผ่านโดเมนจริง
# (ผ่าน nginx เหมือนผู้ใช้ เพื่อให้ตรวจได้ว่าเส้นทางสาธารณะยังทำงาน) · route ส่งอีเมลถึง OWNER และคืน JSON สรุป
# ล้ม (ไม่ใช่ 200) → ส่งอีเมลเตือนผู้ดูแลผ่าน notify ของ lib-common.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ops/lib-common.sh
. "${SCRIPT_DIR}/lib-common.sh"

SECRET="$(env_get CRON_SECRET "")"
BASE_URL="$(env_get APP_BASE_URL "$(env_get BETTER_AUTH_URL "")")"

if [[ -z "$SECRET" || -z "$BASE_URL" ]]; then
  log "ข้าม — ยังไม่ได้ตั้ง CRON_SECRET หรือ APP_BASE_URL/BETTER_AUTH_URL ใน .env"
  exit 0
fi

URL="${BASE_URL%/}/api/cron/plan-expiry/${SECRET}"
TMP="$(mktemp)"
HTTP_CODE="$(curl -sS -o "$TMP" -w '%{http_code}' --max-time 60 "$URL" || echo 000)"
BODY="$(cat "$TMP" 2>/dev/null || true)"
rm -f "$TMP"

if [[ "$HTTP_CODE" != "200" ]]; then
  log "ล้ม HTTP ${HTTP_CODE}: ${BODY}"
  notify "[MJD] cron เตือนแพ็กเกจหมดอายุล้มเหลว" "HTTP ${HTTP_CODE}
${BODY}
เวลา: $(date '+%Y-%m-%d %H:%M:%S')" || true
  exit 1
fi

log "สำเร็จ: ${BODY}"
