import { findBrandAssetById } from "@/lib/store-resolve"

/// เสิร์ฟโลโก้แบรนด์ — public โดยตั้งใจเหมือน /api/assets/[id] (หน้าเมนูลูกค้าไม่มี session)
/// id ผูกกับไฟล์ตัวนั้นตลอดชีวิต (เปลี่ยนโลโก้ = อัปโหลดใหม่ได้ id ใหม่) จึงแคชยาวได้
export const dynamic = "force-dynamic"

export async function GET(_request: Request, { params }: RouteContext<"/api/brand-assets/[id]">) {
  const { id } = await params

  const asset = await findBrandAssetById(id)
  if (!asset) {
    return new Response("ไม่พบรูปภาพนี้", { status: 404, headers: { "Cache-Control": "no-store" } })
  }

  return new Response(Buffer.from(asset.data), {
    status: 200,
    headers: {
      "Content-Type": asset.contentType,
      "Content-Length": String(asset.data.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  })
}
