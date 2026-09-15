#!/usr/bin/env bash
#
# install-cron.sh — ติดตั้งงานตามเวลาให้ผู้ใช้ deploy บน VPS
#
#   bash ops/install-cron.sh          # ติดตั้ง/อัปเดต
#   bash ops/install-cron.sh --show   # ดูของที่ติดตั้งไว้
#   bash ops/install-cron.sh --remove # ถอนออก
#
# ใช้ crontab ของผู้ใช้ ไม่ใช่ /etc/cron.d/ — จึง **ไม่ต้องใช้ sudo**
# (ทั้งสองสคริปต์ทำงานผ่าน docker ซึ่ง deploy อยู่กลุ่ม docker อยู่แล้ว)
#
# รันซ้ำได้ — ลบบล็อกเดิมที่คั่นด้วย marker ออกก่อนเขียนใหม่ทุกครั้ง

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ops/lib-common.sh
. "${SCRIPT_DIR}/lib-common.sh"

MARK_BEGIN="# >>> MJD ops (จัดการโดย ops/install-cron.sh) >>>"
MARK_END="# <<< MJD ops <<<"
LOG_DIR="${LOG_DIR:-/home/deploy/logs}"

current_crontab() { crontab -l 2>/dev/null || true; }

strip_block() {
  current_crontab | awk -v b="$MARK_BEGIN" -v e="$MARK_END" '
    $0==b {skip=1} !skip {print} $0==e {skip=0}'
}

case "${1:-install}" in
  --show)
    log "crontab ของ $(whoami) ตอนนี้:"
    current_crontab | sed 's/^/  /'
    exit 0
    ;;
  --remove)
    strip_block | crontab -
    ok "ถอนงานตามเวลาของ MJD ออกแล้ว (ของคนอื่นไม่ถูกแตะ)"
    exit 0
    ;;
esac

mkdir -p "$LOG_DIR"

{
  strip_block
  echo "$MARK_BEGIN"
  echo "# backup ฐานข้อมูลทุกวัน 03:17 — เวลาแปลก ๆ โดยตั้งใจ เลี่ยงชนกับงานอื่นที่มักตั้งลงตัว"
  echo "17 3 * * * ${SCRIPT_DIR}/backup-db.sh >> ${LOG_DIR}/backup.log 2>&1"
  echo "# เฝ้า health ทุก 5 นาที — เตือนเฉพาะตอนสถานะเปลี่ยน และต้องล้มติดกัน 2 ครั้ง"
  echo "*/5 * * * * ${SCRIPT_DIR}/health-alert.sh >> ${LOG_DIR}/health.log 2>&1"
  echo "# ซ้อมกู้คืนทุกวันอาทิตย์ 04:05 — backup ที่ไม่เคยซ้อมกู้เท่ากับไม่มี backup"
  echo "5 4 * * 0 ${SCRIPT_DIR}/restore-db.sh --drill >> ${LOG_DIR}/restore-drill.log 2>&1"
  echo "# เตือนแพ็กเกจใกล้หมดอายุ 7/3/1 วัน ทุกวัน 09:10 (Phase 14b) — ยิง route ของแอปด้วย CRON_SECRET จาก .env"
  echo "10 9 * * * ${SCRIPT_DIR}/plan-expiry-cron.sh >> ${LOG_DIR}/plan-expiry.log 2>&1"
  echo "$MARK_END"
} | crontab -

ok "ติดตั้งแล้ว — log อยู่ที่ ${LOG_DIR}/"
log ""
log "รายการที่ติดตั้ง:"
current_crontab | awk -v b="$MARK_BEGIN" -v e="$MARK_END" '$0==b{p=1} p{print "  " $0} $0==e{p=0}'
