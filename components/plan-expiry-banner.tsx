import Link from "next/link"
import { expiryNoticeLevel, remainingDays } from "@/lib/subscription"

/// แบนเนอร์เตือนแพ็กเกจ (Phase 14b) — คำนวณสดจาก Store.planExpiresAt ทุกคำขอ ไม่มีแถวแจ้งเตือน หายเองเมื่อต่ออายุ
/// แสดงกับทุกคนในร้าน (พนักงานควรรู้ว่าจะขายไม่ได้) แต่ปุ่มไปหน้าค่าใช้งานให้เฉพาะ OWNER
export function PlanExpiryBanner({ expiresAt, isOwner, now = new Date() }: { expiresAt: Date | null; isOwner: boolean; now?: Date }) {
  const level = expiryNoticeLevel(now, expiresAt)
  if (level === 0) return null

  const left = remainingDays(now, expiresAt)
  const expired = level === -1
  const text = !expiresAt
    ? "ร้านยังไม่ได้เปิดใช้งานแพ็กเกจ — เปิดโต๊ะ/ขาย/รับออเดอร์ยังไม่ได้"
    : expired
      ? "แพ็กเกจของร้านหมดอายุแล้ว — ดูข้อมูลเดิมได้ แต่เปิดโต๊ะ/ขาย/รับออเดอร์ใหม่ไม่ได้จนกว่าจะต่ออายุ"
      : `แพ็กเกจของร้านจะหมดอายุใน ${left} วัน — ต่ออายุล่วงหน้าได้ วันที่เหลือไม่หาย`

  return (
    <div className={`alert-banner ${expired ? "danger" : "warning"}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <span>{text}</span>
      {isOwner ? (
        <Link href="/billing" className="btn btn-primary btn-sm">
          {expired ? "ต่ออายุ / เปิดใช้งาน" : "ต่ออายุตอนนี้"}
        </Link>
      ) : (
        <span className="t-caption">แจ้งเจ้าของร้านให้ต่ออายุ</span>
      )}
    </div>
  )
}
