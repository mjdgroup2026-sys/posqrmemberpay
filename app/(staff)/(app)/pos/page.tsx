import { formatBusinessDate } from "@/lib/format"
import { listProductOptions, listCategoryOptions } from "@/lib/queries"
import { PosTerminal } from "@/components/pos-terminal"
import { requirePageAccess } from "@/lib/permissions"

export const metadata = { title: "ขายหน้าร้าน (POS)" }

export default async function PosPage() {
  // ด่านชั้นที่ 1 ของ §4 — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId, granted } = await requirePageAccess("POS")

  const [products, categories] = await Promise.all([listProductOptions(storeId), listCategoryOptions(storeId)])

  // Phase 19 — วันที่ขาย (วันทางธุรกิจ เวลาไทย) จัดรูปแบบฝั่ง server จะได้ไม่ต่างกันระหว่างเครื่องแคชเชียร์
  const dateLabel = formatBusinessDate(new Date())

  return <PosTerminal products={products} categories={categories} allowed={granted.POS ?? []} dateLabel={dateLabel} />
}
