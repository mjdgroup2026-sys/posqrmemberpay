import { getStoreSettings } from "@/lib/queries"
import { findStoreByQrToken } from "@/lib/store-resolve"

/// ธีมของร้าน (Phase 13) — ร้านรู้ได้จาก qrToken เท่านั้น จึงตั้งที่ segment นี้ ไม่ใช่ root layout
///
/// สีของร้าน override ตอน runtime — inline style บน wrapper ชนะ selector [data-theme] เสมอ
/// จึงไม่ต้อง generate CSS ใหม่ต่อร้าน (ดูกติกาธีมข้อ 4 ใน CLAUDE.md) · ค่านี้ผ่าน zod ที่บังคับ hex 6 หลัก
/// มาแล้ว จึงยัดลง style ได้โดยไม่เปิดช่องให้เขียน CSS เอง · `display: contents` ทำให้ wrapper
/// ไม่สร้างกล่องใหม่ในเลย์เอาต์ แต่ตัวแปร CSS ยังไหลลงลูกทุกตัว
export default async function CustomerStoreLayout({ children, params }: LayoutProps<"/order/[qrToken]">) {
  const { qrToken } = await params
  const store = await findStoreByQrToken(qrToken)
  const settings = store ? await getStoreSettings(store.storeId) : null

  return (
    <div
      style={
        {
          display: "contents",
          ...(settings?.themeColor ? { "--brand": settings.themeColor } : {}),
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  )
}
