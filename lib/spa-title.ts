import "server-only"
import type { Metadata } from "next"
import { requireStorePage } from "@/lib/permissions"
import { getStoreSettings } from "@/lib/queries"

/// ชื่อแท็บเบราว์เซอร์ของหน้าที่ใช้ร่วมกันระหว่างอาหารกับสปา (2026-09-23 เจ้าของสั่ง)
/// ร้านที่เปิดตัวเลือกร้านนวดเห็นชื่อ "…/ร้านสปา" · ร้านอาหารล้วนเห็นชื่อเดิม
export async function spaAwareMetadata(foodTitle: string, spaTitle: string): Promise<Metadata> {
  const { storeId } = await requireStorePage()
  const settings = await getStoreSettings(storeId)
  return { title: settings?.spaEnabled ? spaTitle : foodTitle }
}
