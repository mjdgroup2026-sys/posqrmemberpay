import Link from "next/link"
import { formatBaht } from "@/lib/format"
import type { OpenBill } from "@/lib/queries"
import { IconReceipt } from "@/components/icons"

/// ชื่อที่แสดงของบิล — ไม่มีชื่อลูกค้า = "บิลที่ n" ตามลำดับเวลาเปิด
export function billLabel(bill: OpenBill, index: number): string {
  return bill.label ?? `บิลที่ ${index + 1}`
}

/// ตัวสลับบิลของห้องสปาที่มีลูกค้าหลายคน (2026-09-23 · 1 ลูกค้า = 1 บิล)
///
/// โชว์เฉพาะเมื่อห้องมีบิลเปิดอยู่มากกว่า 1 ใบ — โต๊ะอาหาร/ห้องที่มีบิลเดียวไม่เห็นอะไรเปลี่ยน
/// `hrefFor` สร้างลิงก์ของแต่ละใบ (หน้ารายละเอียด หรือหน้าปิดบิล)
export function BillSwitcher({
  bills,
  currentSessionId,
  hrefFor,
}: {
  bills: OpenBill[]
  currentSessionId: string
  hrefFor: (sessionId: string) => string
}) {
  if (bills.length <= 1) return null
  return (
    <div className="alert-banner info" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span>
        ห้องนี้มีบิลของลูกค้า <span className="num">{bills.length}</span> คนเปิดอยู่ — แต่ละคนจ่ายแยกบิล เลือกบิลที่ต้องการ
      </span>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="tablist" aria-label="บิลในห้องนี้">
        {bills.map((bill, index) => {
          const active = bill.sessionId === currentSessionId
          return (
            <Link
              key={bill.sessionId}
              href={hrefFor(bill.sessionId)}
              role="tab"
              aria-selected={active}
              className={`btn btn-sm ${active ? "btn-primary" : "btn-subtle"}`}
            >
              <IconReceipt size={14} aria-hidden />
              {billLabel(bill, index)}
              <span className="num">฿{formatBaht(bill.total)}</span>
              {bill.status === "AWAITING_BILL" ? <span className="t-caption">· ขอเช็กบิล</span> : null}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
