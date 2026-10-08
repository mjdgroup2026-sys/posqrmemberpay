import Link from "next/link"

/// แถบเตือนบนหน้าที่รับเงิน (จอขาย · หน้าปิดบิล) เมื่อแคชเชียร์ปิดยอดรอบล่าสุดแล้ว (2026-10-08)
/// ด่านจริงอยู่ที่ `salesLockError()` ฝั่ง server — แถบนี้แค่บอกก่อนจะกดแล้วโดนปฏิเสธ
export function SalesLockBanner({ roundNo }: { roundNo: number | null }) {
  return (
    <div className="alert-banner warning" role="status" style={{ marginBottom: 16 }}>
      <strong>คุณปิดยอดรอบที่ {roundNo} ของวันนี้แล้ว — ตอนนี้รับเงินไม่ได้</strong>
      <br />
      สั่งอาหาร/ส่งครัวได้ตามปกติ แต่ปิดบิลและขายกลับบ้านต้อง{" "}
      <Link href="/pos/closing">เปิดรอบขายใหม่ที่หน้าปิดยอดประจำวัน</Link> ก่อน
    </div>
  )
}
