#!/usr/bin/env bash
#
# rollback.sh — ย้อนแอปกลับไป image เวอร์ชันก่อนหน้า
#
#   bash ops/rollback.sh                 # ย้อนไป :previous (tag ที่ CD เก็บไว้ให้)
#   bash ops/rollback.sh sha-dc5237b     # ย้อนไป tag ที่ระบุ
#   bash ops/rollback.sh --list          # ดู tag ที่มีให้เลือกบนเครื่องนี้
#
# ทำงานโดยเปลี่ยนค่า APP_TAG ใน .env ของ stack แล้ว up -d ใหม่
# (docker-compose.prod.yml ใช้ image: ...:${APP_TAG:-latest})
#
# ถ้า health ไม่ผ่านภายใน 60 วินาที จะ **ย้อนค่ากลับให้เอง** แล้ว up -d อีกรอบ
# — ปลอดภัยกว่าปล่อยค้างอยู่กับเวอร์ชันที่ก็ใช้ไม่ได้
#
# ⚠️ rollback นี้ย้อนเฉพาะ "แอป" ไม่ย้อน "ฐานข้อมูล" — ถ้าเวอร์ชันที่จะย้อนกลับไป
#    ใช้ schema เก่ากว่าที่ migrate ไปแล้ว ต้องกู้ฐานด้วย ops/restore-db.sh ควบคู่

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ops/lib-common.sh
. "${SCRIPT_DIR}/lib-common.sh"

IMAGE_REPO="${IMAGE_REPO:-ghcr.io/mjdgroup2026-sys/posqrmemberpay}"
TARGET_TAG="${1:-previous}"

require_docker
[ -f "$ENV_FILE" ] || fail "ไม่พบ ${ENV_FILE}"

if [ "$TARGET_TAG" = "--list" ]; then
  log "tag ที่มีอยู่บนเครื่องนี้:"
  docker image ls "$IMAGE_REPO" --format '  {{.Tag}}\t{{.CreatedSince}}\t{{.Size}}' | grep -v 'migrate' || log "  (ไม่มี)"
  log ""
  log "APP_TAG ที่ใช้อยู่ตอนนี้: $(env_get APP_TAG latest)"
  exit 0
fi

CURRENT_TAG="$(env_get APP_TAG latest)"
[ "$TARGET_TAG" != "$CURRENT_TAG" ] || fail "APP_TAG เป็น ${TARGET_TAG} อยู่แล้ว ไม่ต้องย้อน"

log "═══════════════════════════════════════════════════════════"
log " ย้อนแอป: ${CURRENT_TAG} → ${TARGET_TAG}"
log "═══════════════════════════════════════════════════════════"

step "1/3 เตรียม image ${IMAGE_REPO}:${TARGET_TAG}"
if docker image inspect "${IMAGE_REPO}:${TARGET_TAG}" > /dev/null 2>&1; then
  ok "มี image อยู่บนเครื่องแล้ว ไม่ต้องดึงใหม่"
elif docker pull "${IMAGE_REPO}:${TARGET_TAG}" > /dev/null 2>&1; then
  ok "ดึงจาก registry สำเร็จ"
else
  # เจตนา: registry ล่มก็ยังต้อง rollback ได้ถ้ามี image ค้างบนเครื่อง
  fail "ไม่มี image นี้ทั้งบนเครื่องและใน registry — ดู tag ที่เลือกได้ด้วย: bash ops/rollback.sh --list"
fi

# ── เปลี่ยน APP_TAG ใน .env (เขียนทับบรรทัดเดิม หรือเพิ่มถ้ายังไม่มี) ────────
set_tag() {
  local tag="$1"
  if grep -qE '^APP_TAG=' "$ENV_FILE"; then
    sed -i "s|^APP_TAG=.*|APP_TAG=${tag}|" "$ENV_FILE"
  else
    printf '\nAPP_TAG=%s\n' "$tag" >> "$ENV_FILE"
  fi
}

step "2/3 ตั้ง APP_TAG=${TARGET_TAG} แล้วสลับสีไปเวอร์ชันนั้น"
set_tag "$TARGET_TAG"
# ย้อนเวอร์ชันก็ต้องไม่มี downtime เหมือน deploy ปกติ — switch-deploy.sh สตาร์ตสีใหม่
# ด้วย tag นี้ ตรวจ health เอง แล้วค่อยสลับ nginx · ล้มเมื่อไหร่มันคืนสีเดิมให้เองอยู่แล้ว
if bash "${SCRIPT_DIR}/switch-deploy.sh"; then
  step "3/3 สรุป"
  log ""
  log "✅ ย้อนสำเร็จ — ตอนนี้รัน ${IMAGE_REPO}:${TARGET_TAG}"
  log "   จะย้อนกลับไปตัวเดิม: bash ops/rollback.sh ${CURRENT_TAG}"
  exit 0
fi

step "3/3 สลับไม่สำเร็จ — คืนค่า"
# nginx ยังชี้สีเดิมที่รัน ${CURRENT_TAG} อยู่ (switch-deploy.sh คืนให้เองแล้ว)
# เหลือแค่คืนค่า APP_TAG ใน .env ไม่ให้ deploy รอบหน้าหยิบ tag ที่ใช้ไม่ได้ไปใช้ต่อ
set_tag "$CURRENT_TAG"
notify "[MJD] rollback ไป ${TARGET_TAG} ไม่สำเร็จ" \
  "ย้อนค่า APP_TAG กลับเป็น ${CURRENT_TAG} ให้แล้ว และ nginx ยังชี้สีเดิมตามปกติ
เวลา: $(date '+%Y-%m-%d %H:%M:%S')"
fail "ย้อนไป ${TARGET_TAG} ไม่สำเร็จ — คืนค่าเป็น ${CURRENT_TAG} แล้ว (ระบบยังให้บริการตามปกติ)"
