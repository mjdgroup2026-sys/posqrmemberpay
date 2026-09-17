import { findAssetById } from "@/lib/store-resolve"

/// เสิร์ฟรูปที่ร้านอัปโหลด (Phase 17a)
///
/// **เป็น public โดยตั้งใจ** — หน้าเมนูฝั่งลูกค้า (`/order/[qrToken]`) ไม่มี session ใด ๆ
/// ตัวระบุคือ id (cuid) ซึ่ง unique ทั้งระบบ · การค้นด้วย id ข้ามร้านอยู่ใน lib/store-resolve.ts
/// ตามกติกาข้อ 5 และคืนเฉพาะไบต์รูป ไม่มีข้อมูลร้านติดออกไป
///
/// ต้อง dynamic — ไม่งั้น Next.js จะพยายาม prerender ตอน build ทั้งที่ยังไม่มีฐานข้อมูลให้ต่อ
export const dynamic = "force-dynamic"

export async function GET(_request: Request, { params }: RouteContext<"/api/assets/[id]">) {
  const { id } = await params

  const asset = await findAssetById(id)
  if (!asset) {
    return new Response("ไม่พบรูปภาพนี้", { status: 404, headers: { "Cache-Control": "no-store" } })
  }

  // แคชยาวได้ปลอดภัยเพราะ id ผูกกับไฟล์ตัวนั้นตลอดชีวิต — เปลี่ยนรูป = อัปโหลดใหม่ได้ id ใหม่
  // (กฎ no-cache ใน next.config.ts ยกเว้น /api/ ไว้อยู่แล้ว route จึงตั้งค่าของตัวเองได้)
  return new Response(Buffer.from(asset.data), {
    status: 200,
    headers: {
      "Content-Type": asset.contentType,
      "Content-Length": String(asset.data.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  })
}
