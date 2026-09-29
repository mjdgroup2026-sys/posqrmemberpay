import type { SaleKind } from "@/lib/queries"

/// ชื่อ + สีของแต่ละประเภท (20e) — ลำดับตายตัว สีผูกกับประเภท ไม่ผูกกับอันดับยอด
/// (ร้านที่ไม่มีสปาซ่อนแท่งนวด แต่อาหารยังเป็นสีช่อง 1 เสมอ)
/// อยู่นอกไฟล์ "use client" โดยตั้งใจ — ค่าที่ export จาก client module ถูกแปลงเป็น client reference
/// เมื่อ Server Component import ไป (`.map` ไม่ใช่ function → /reports 500)
export const SALE_KIND_SERIES: { kind: SaleKind; label: string; color: string }[] = [
  { kind: "FOOD", label: "อาหาร/เครื่องดื่ม", color: "var(--chart-1)" },
  { kind: "SERVICE", label: "นวด/สปา", color: "var(--chart-2)" },
  { kind: "PRODUCT", label: "สินค้าหน้าร้าน", color: "var(--chart-3)" },
]
