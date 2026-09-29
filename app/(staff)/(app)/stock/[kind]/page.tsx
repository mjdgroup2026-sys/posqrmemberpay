import Link from "next/link"
import { notFound } from "next/navigation"
import { listStockDocuments } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { DOC_STATUS_CHIP, stockDocKind } from "@/lib/stock-doc-kinds"
import { businessDayKey, resolveDayRange } from "@/lib/day"
import { formatBaht, formatBusinessDate, formatNumber } from "@/lib/format"
import { DayRangePicker } from "@/components/day-range-picker"
import { IconPlus } from "@/components/icons"

/// รายการเอกสารคลัง (Phase 21 · F30) — ใบรับ / ใบเบิก / ใบปรับ ใช้หน้าเดียวกัน ต่างกันที่ `[kind]`
export async function generateMetadata({ params }: PageProps<"/stock/[kind]">) {
  const kind = stockDocKind((await params).kind)
  return { title: kind?.title ?? "เอกสารคลัง" }
}

export default async function StockDocListPage({ params, searchParams }: PageProps<"/stock/[kind]">) {
  const kind = stockDocKind((await params).kind)
  if (!kind) notFound()
  // ด่านชั้นที่ 1 ของ §4 — VIEW ของ resource ที่คุมเอกสารประเภทนี้
  const { storeId, granted } = await requirePageAccess(kind.resource)
  const canAdd = granted[kind.resource]?.includes("ADD") ?? false

  const query = await searchParams
  // เปิดมาที่ 30 วันล่าสุด — เอกสารคลังไม่ได้เกิดทุกวันเหมือนบิลขาย เปิดวันเดียวมักว่าง
  const range = resolveDayRange(query.from, query.to, 30)
  // (21d) ?status=open = ใบรับที่ยังค้างรับทุกวันที่ (ไม่ใช้ช่วงวัน)
  const openOnly = kind.type === "RECEIPT" && query.status === "open"
  const docs = await listStockDocuments(storeId, kind.type, range, { openOnly })
  const basePath = `/stock/${kind.slug}`
  const isReceipt = kind.type === "RECEIPT"

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">คลังสินค้า</p>
          <h1 className="t-h1">{kind.title}</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            {kind.description}
          </p>
        </div>
        <div className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          {isReceipt ? (
            <div className="row" style={{ gap: 6 }}>
              <Link href={basePath} className={`btn btn-sm ${openOnly ? "btn-ghost" : "btn-subtle"}`} aria-current={openOnly ? undefined : "page"}>
                ตามช่วงวันที่
              </Link>
              <Link href={`${basePath}?status=open`} className={`btn btn-sm ${openOnly ? "btn-subtle" : "btn-ghost"}`} aria-current={openOnly ? "page" : undefined}>
                ค้างรับทั้งหมด
              </Link>
            </div>
          ) : null}
          {openOnly ? null : <DayRangePicker basePath={basePath} from={range.from} to={range.to} today={businessDayKey()} />}
          {canAdd ? (
            <Link href={`${basePath}/new`} className="btn btn-primary">
              <IconPlus size={17} aria-hidden />
              {kind.newTitle}
            </Link>
          ) : null}
        </div>
      </div>

      <section className="card-ui">
        {docs.length === 0 ? (
          <p className="t-body" style={{ padding: 24 }}>
            {openOnly ? "ไม่มีใบรับที่ค้างรับ" : `ไม่มี${kind.title}ในช่วงวันที่เลือก`}
          </p>
        ) : (
          <div className="datatable-wrap">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                  <th style={{ padding: "10px 16px", fontWeight: 500 }}>เลขที่</th>
                  <th style={{ padding: "10px 16px", fontWeight: 500 }}>วันที่</th>
                  <th style={{ padding: "10px 16px", fontWeight: 500 }}>{kind.partyLabel}</th>
                  {isReceipt ? <th style={{ padding: "10px 16px", fontWeight: 500 }}>เลขที่อ้างอิง</th> : null}
                  <th style={{ padding: "10px 16px", fontWeight: 500, textAlign: "right" }}>รายการ</th>
                  <th style={{ padding: "10px 16px", fontWeight: 500, textAlign: "right" }}>
                    {kind.type === "ADJUST" ? "ส่วนต่างรวม" : isReceipt ? "สั่ง" : "จำนวนรวม"}
                  </th>
                  {isReceipt ? <th style={{ padding: "10px 16px", fontWeight: 500, textAlign: "right" }}>รับแล้ว</th> : null}
                  {isReceipt ? (
                    <th style={{ padding: "10px 16px", fontWeight: 500, textAlign: "right" }}>มูลค่า</th>
                  ) : null}
                  <th style={{ padding: "10px 16px", fontWeight: 500 }}>ผู้บันทึก</th>
                  <th style={{ padding: "10px 16px", fontWeight: 500 }}>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc) => (
                  <tr key={doc.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "10px 16px" }}>
                      <Link href={`${basePath}/${doc.id}`} className="num" style={{ fontWeight: 600, color: "var(--brand)" }}>
                        {doc.docNumber}
                      </Link>
                    </td>
                    <td className="num" style={{ padding: "10px 16px" }}>
                      {formatBusinessDate(doc.docDate)}
                    </td>
                    <td style={{ padding: "10px 16px" }}>{doc.party ?? "—"}</td>
                    {isReceipt ? (
                      <td className="num" style={{ padding: "10px 16px" }}>
                        {doc.referenceNo ?? "—"}
                      </td>
                    ) : null}
                    <td className="num" style={{ padding: "10px 16px", textAlign: "right" }}>
                      {formatNumber(doc.lineCount)}
                    </td>
                    <td className="num" style={{ padding: "10px 16px", textAlign: "right" }}>
                      {kind.type === "ADJUST" && doc.totalQuantity > 0 ? "+" : ""}
                      {formatNumber(doc.totalQuantity)}
                    </td>
                    {isReceipt ? (
                      <td className="num" style={{ padding: "10px 16px", textAlign: "right" }}>
                        {formatNumber(doc.receivedQuantity)}
                      </td>
                    ) : null}
                    {isReceipt ? (
                      <td className="num" style={{ padding: "10px 16px", textAlign: "right" }}>
                        {doc.totalCost === null ? "—" : `฿${formatBaht(doc.totalCost)}`}
                      </td>
                    ) : null}
                    <td style={{ padding: "10px 16px" }}>{doc.createdByName}</td>
                    <td style={{ padding: "10px 16px" }}>
                      <span className={`chip chip-${DOC_STATUS_CHIP[doc.status].tone}`}>
                        <span className="dot" />
                        {DOC_STATUS_CHIP[doc.status].label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
