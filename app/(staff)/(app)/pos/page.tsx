import { redirect } from "next/navigation"

/// Phase 21 (เจ้าของสั่ง 2026-09-28) — ปิดหน้าขายหน้าร้าน (POS) ให้ไปขายที่จอขายอาหารแทน
/// ซึ่งขายสินค้าในสต็อกได้แล้ว (เฉพาะหมวดที่เปิด "ขายที่หน้าขายอาหาร") · บิล RETAIL_POS เก่ายังดู/void ได้ที่ /pos/history
export default function PosPage() {
  redirect("/mobile-order/pos")
}
