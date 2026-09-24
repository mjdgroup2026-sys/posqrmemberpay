import Link from "next/link"
import { redirect } from "next/navigation"
import { getBillingView } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { BillingForm } from "@/components/billing-form"
import { billLabel } from "@/components/bill-switcher"
import { formatBaht } from "@/lib/format"

export const metadata = { title: "ปิดบิล" }

export default async function BillingPage({ params, searchParams }: PageProps<"/mobile-order/tables/[tableId]/billing">) {
  // ด่านชั้นที่ 1 ของ §4 (Phase 16) — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId, granted } = await requirePageAccess("MO_TABLES")
  // ปิดบิล = MO_TABLES:EDIT — มีแค่ VIEW ให้ดูยอดได้แต่กดยืนยันไม่ได้ (action ก็ปฏิเสธซ้ำ)
  if (!granted.MO_TABLES?.includes("EDIT")) redirect("/access-denied?resource=MO_TABLES")
  const { tableId } = await params
  // ?session= = บิลของลูกค้าคนไหนในห้องสปาที่มีหลายบิล (2026-09-23)
  const { session } = await searchParams
  const bill = await getBillingView(storeId, tableId, typeof session === "string" && session ? session : undefined)

  if (!bill) {
    return (
      <section className="card-ui card-pad">
        <h1 className="t-h2">ไม่พบโต๊ะที่เปิดอยู่</h1>
        <p className="t-body" style={{ marginTop: 8 }}>
          โต๊ะนี้อาจถูกปิดบิลหรือยกเลิกไปแล้ว
        </p>
        <Link href="/mobile-order/tables" className="btn btn-primary" style={{ marginTop: 16 }}>
          กลับไปผังโต๊ะ
        </Link>
      </section>
    )
  }

  // ห้องสปาหลายบิลแต่ไม่ได้ระบุ ?session= (20e — เจ้าของเจอบิลรวมห้อง) — ห้ามเดาเอาบิลล่าสุดมาปิด
  // ให้เลือกลูกค้าก่อนเสมอ แต่ละคนจ่ายแยกบิลตามกติกา 1 ลูกค้า = 1 บิล
  const pickedSession = typeof session === "string" && session !== ""
  if (!pickedSession && bill.bills.length > 1) {
    return (
      <section className="card-ui card-pad" style={{ maxWidth: 640 }}>
        <h1 className="t-h2">ห้อง {bill.tableCode} — เลือกบิลของลูกค้าที่จะชำระ</h1>
        <p className="t-body" style={{ marginTop: 8 }}>
          ห้องนี้มีลูกค้า <span className="num">{bill.bills.length}</span> คน แต่ละคนชำระแยกบิล ไม่รวมทั้งห้อง
        </p>
        <ul style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {bill.bills.map((open, index) => (
            <li key={open.sessionId} className="row" style={{ justifyContent: "space-between", gap: 10, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              <span style={{ fontWeight: 600 }}>
                {billLabel(open, index)}
                {open.status === "AWAITING_BILL" ? <span className="t-caption"> · ขอเช็กบิล</span> : null}
              </span>
              <span className="row" style={{ gap: 10 }}>
                <span className="num" style={{ fontWeight: 700 }}>
                  ฿{formatBaht(open.total)}
                </span>
                <Link href={`/mobile-order/tables/${bill.tableId}/billing?session=${open.sessionId}`} className="btn btn-accent btn-sm">
                  ชำระบิลนี้
                </Link>
              </span>
            </li>
          ))}
        </ul>
      </section>
    )
  }

  if (bill.lines.length === 0) {
    return (
      <section className="card-ui card-pad">
        <h1 className="t-h2">
          โต๊ะ {bill.tableCode}
          {bill.customerLabel ? ` · ${bill.customerLabel}` : ""} ยังไม่มีรายการที่ต้องชำระ
        </h1>
        <p className="t-body" style={{ marginTop: 8 }}>
          ปิดบิลได้เมื่อมีรายการอาหารอย่างน้อย 1 รายการ — ถ้าลูกค้าไม่สั่งแล้วให้ใช้ปุ่มยกเลิกโต๊ะแทน
        </p>
        <Link href={`/mobile-order/tables/${bill.tableId}?session=${bill.sessionId}`} className="btn btn-primary" style={{ marginTop: 16 }}>
          กลับไปรายละเอียดออร์เดอร์
        </Link>
      </section>
    )
  }

  return <BillingForm bill={bill} />
}
