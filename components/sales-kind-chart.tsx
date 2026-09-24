"use client"

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { formatBaht } from "@/lib/format"
import type { SaleKind } from "@/lib/queries"

type Point = { day: string; PRODUCT: number; FOOD: number; SERVICE: number }

/// ชื่อ + สีของแต่ละประเภท (20e) — ลำดับตายตัว สีผูกกับประเภท ไม่ผูกกับอันดับยอด
/// (ร้านที่ไม่มีสปาซ่อนแท่งนวด แต่อาหารยังเป็นสีช่อง 1 เสมอ)
export const SALE_KIND_SERIES: { kind: SaleKind; label: string; color: string }[] = [
  { kind: "FOOD", label: "อาหาร/เครื่องดื่ม", color: "var(--chart-1)" },
  { kind: "SERVICE", label: "นวด/สปา", color: "var(--chart-2)" },
  { kind: "PRODUCT", label: "สินค้าหน้าร้าน", color: "var(--chart-3)" },
]

/// ยอดขายรายวันแบบแท่งซ้อนแยกประเภท — ความสูงรวมของแท่ง = ยอดของทุกประเภทในวันนั้น (ก่อนส่วนลด/ค่าบริการ)
/// ตัวเลขชุดเดียวกันอยู่ในตารางใต้กราฟด้วย (contrast ของสีช่อง 3 ต่ำกว่า 3:1 ต้องมีทางอ่านที่ไม่พึ่งสี)
export function SalesKindChart({ data, kinds }: { data: Point[]; kinds: SaleKind[] }) {
  const series = SALE_KIND_SERIES.filter((s) => kinds.includes(s.kind))
  const hasSales = data.some((d) => series.some((s) => d[s.kind] > 0))
  if (!hasSales) {
    return (
      <p className="t-body" style={{ padding: 24 }}>
        ยังไม่มียอดขายในช่วงวันที่เลือก
      </p>
    )
  }

  const formatted = data.map((d) => ({
    ...d,
    label: new Date(`${d.day}T00:00:00.000Z`).toLocaleDateString("th-TH", { day: "2-digit", month: "short", timeZone: "UTC" }),
  }))

  return (
    <div style={{ width: "100%", height: 320, padding: "16px 12px 0" }}>
      <ResponsiveContainer>
        <BarChart data={formatted} margin={{ top: 8, right: 16, bottom: 8, left: 0 }} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--ink-3)" }} tickLine={false} axisLine={false} minTickGap={12} />
          <YAxis tick={{ fontSize: 12, fill: "var(--ink-3)" }} tickLine={false} axisLine={false} width={70} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            contentStyle={{ borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, background: "var(--surface)", color: "var(--ink)" }}
            formatter={(value, name) => [`฿${formatBaht(Number(value))}`, name]}
          />
          <Legend iconType="square" wrapperStyle={{ fontSize: 13, color: "var(--ink-2)" }} />
          {series.map((s, index) => (
            <Bar
              key={s.kind}
              dataKey={s.kind}
              name={s.label}
              stackId="kind"
              fill={s.color}
              // เส้นขอบสีพื้นผิว 2px = ช่องว่างระหว่างชั้นของแท่งซ้อน · มุมโค้งเฉพาะชั้นบนสุด
              stroke="var(--surface)"
              strokeWidth={2}
              radius={index === series.length - 1 ? [4, 4, 0, 0] : 0}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
