import Link from "next/link"
import { getBillingView } from "@/lib/queries"
import { requireStorePage } from "@/lib/permissions"
import { BillingForm } from "@/components/billing-form"

export const metadata = { title: "ปิดบิล" }

export default async function BillingPage({ params }: PageProps<"/mobile-order/tables/[tableId]/billing">) {
  const { storeId } = await requireStorePage()
  const { tableId } = await params
  const bill = await getBillingView(storeId, tableId)

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

  if (bill.lines.length === 0) {
    return (
      <section className="card-ui card-pad">
        <h1 className="t-h2">โต๊ะ {bill.tableCode} ยังไม่มีรายการที่ต้องชำระ</h1>
        <p className="t-body" style={{ marginTop: 8 }}>
          ปิดบิลได้เมื่อมีรายการอาหารอย่างน้อย 1 รายการ — ถ้าลูกค้าไม่สั่งแล้วให้ใช้ปุ่มยกเลิกโต๊ะแทน
        </p>
        <Link href={`/mobile-order/tables/${bill.tableId}`} className="btn btn-primary" style={{ marginTop: 16 }}>
          กลับไปรายละเอียดออร์เดอร์
        </Link>
      </section>
    )
  }

  return <BillingForm bill={bill} />
}
