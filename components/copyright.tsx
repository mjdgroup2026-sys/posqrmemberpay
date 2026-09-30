/// ลิขสิทธิ์ของแพลตฟอร์ม — วางท้ายทุกพื้นผิว (sidebar พนักงาน · หน้าล็อกอิน · หน้าลูกค้า) ด้วย component เดียว
/// ตั้งใจให้เบา (สี --ink-3 ขนาด caption) ไม่แย่งที่โลโก้/ชื่อร้าน · ไม่ผูก provider จึงใช้ได้ทั้งสอง route group
/// ไม่มี "use client" — ใช้ได้ทั้งใน Server Component และ client component (sidebar)
export function Copyright({ className }: { className?: string }) {
  return (
    <p className={className ? `copyright ${className}` : "copyright"}>
      © {new Date().getFullYear()} <strong>MJD GROUP</strong> · สงวนลิขสิทธิ์
    </p>
  )
}
