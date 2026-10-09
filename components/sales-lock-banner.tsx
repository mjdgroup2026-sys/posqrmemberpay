import Link from "next/link"
import { ResumeSalesButton } from "@/components/resume-sales-button"

/// แจ้งเตือนเมื่อพนักงานปิดยอดรอบล่าสุดแล้ว (2026-10-08 · 2026-10-09 ขยายเป็น "ขายไม่ได้เลย")
/// ด่านจริงอยู่ที่ `salesLockError()` ฝั่ง server — ตัวนี้แค่บอกก่อนจะกดแล้วโดนปฏิเสธ
/// · `block` = แทนที่หน้าขายทั้งหน้า (จอขาย) · ไม่ระบุ = แถบเตือนบนหน้าที่ยังดู/ทำงานครัวได้ (ผังโต๊ะ · ปิดบิล · คิวนวด)
/// · `canResume` = มีสิทธิ์ `POS_CLOSING:ADD` (สิทธิ์เดียวกับ `resumeSales`) จึงโชว์ปุ่มเปิดรอบขายใหม่ในตัว
export function SalesLockBanner({
  roundNo,
  canResume,
  block = false,
}: {
  roundNo: number | null
  canResume: boolean
  block?: boolean
}) {
  const action = canResume ? (
    <ResumeSalesButton />
  ) : (
    <span className="t-small">ให้ผู้ที่มีสิทธิ์ปิดยอดกด “เปิดรอบขายใหม่” ที่ <Link href="/pos/closing">หน้าปิดยอดประจำวัน</Link></span>
  )

  if (block) {
    return (
      <div className="card-ui card-pad" role="alert" style={{ maxWidth: 560, margin: "48px auto", textAlign: "center" }}>
        <p className="t-eyebrow">ปิดรอบแล้ว</p>
        <h1 className="t-h2" style={{ margin: "8px 0" }}>
          ปิดรอบที่ {roundNo} ไปแล้ว ไม่สามารถขายได้
        </h1>
        <p className="t-body" style={{ marginBottom: 20 }}>
          ต้องเปิดรอบขายใหม่ก่อน จึงจะเปิดโต๊ะ สั่งอาหาร ขายกลับบ้าน หรือรับเงินได้
        </p>
        {action}
      </div>
    )
  }

  return (
    <div className="alert-banner warning" role="status" style={{ marginBottom: 16 }}>
      <div>
        <strong>ปิดรอบที่ {roundNo} ไปแล้ว ไม่สามารถขายได้ — ต้องเปิดรอบขายใหม่ก่อน</strong>
        <br />
        <span className="t-small">ครัว/เสิร์ฟ/นวดของออร์เดอร์เดิมทำต่อได้ตามปกติ แต่เปิดโต๊ะ สั่งเพิ่ม เช็กอิน และรับเงินไม่ได้</span>
      </div>
      <div style={{ marginTop: 8 }}>{action}</div>
    </div>
  )
}
