import { redirect } from "next/navigation"

/// Phase 21 — หน้าเบิกจ่ายทีละรายการเดิมถูกปิด (เจ้าของสั่ง 2026-09-28) ใช้ใบเบิกสินค้าแบบเอกสารแทน
/// คง route ไว้เป็น redirect เพราะผู้ใช้อาจบุ๊กมาร์กไว้
export default function StockOutPage() {
  redirect("/stock/issues")
}
