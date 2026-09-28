import Link from "next/link"
import { notFound } from "next/navigation"
import { getStockDocument } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { SLUG_OF_TYPE, stockDocKind } from "@/lib/stock-doc-kinds"
import { formatBaht, formatBusinessDate, formatDateTime, formatNumber } from "@/lib/format"
import { StockDocActions } from "@/components/stock-doc-actions"
import { IconBack } from "@/components/icons"

export const metadata = { title: "เอกสารคลัง" }

const VOID_HINT = {
  RECEIPT: "ระบบจะตัดของที่รับเข้าตามใบนี้ออกจากสต็อกด้วยรายการชดเชย — ถ้าของถูกขาย/เบิกไปจนเหลือไม่พอ จะยกเลิกไม่ได้",
  ISSUE: "ระบบจะคืนของที่เบิกตามใบนี้เข้าสต็อกด้วยรายการชดเชย",
  ADJUST: "ระบบจะกลับทิศส่วนต่างของทุกบรรทัดด้วยรายการชดเชย (การขาย/เบิกที่เกิดหลังปรับยอดยังคงอยู่)",
} as const

const SIGNATURES = {
  RECEIPT: ["ผู้ส่งของ", "ผู้รับของ", "ผู้ตรวจสอบ"],
  ISSUE: ["ผู้เบิก", "ผู้จ่ายของ", "ผู้อนุมัติ"],
  ADJUST: ["ผู้นับ", "ผู้ตรวจสอบ", "ผู้อนุมัติ"],
} as const

const cell = { padding: "8px 12px" } as const
const numCell = { padding: "8px 12px", textAlign: "right" } as const
const head = { padding: "8px 12px", fontWeight: 500 } as const
const numHead = { padding: "8px 12px", fontWeight: 500, textAlign: "right" } as const

/// ดู/พิมพ์เอกสารคลัง (Phase 21 · F30) — เอกสารแก้ไม่ได้ ยกเลิกได้อย่างเดียว
export default async function StockDocDetailPage({ params }: PageProps<"/stock/[kind]/[id]">) {
  const { kind: slug, id } = await params
  const kind = stockDocKind(slug)
  if (!kind) notFound()
  const { storeId, granted } = await requirePageAccess(kind.resource)

  const doc = await getStockDocument(storeId, id)
  // เอกสารประเภทอื่นที่ถูกเปิดผ่าน URL ของอีกประเภท = ไม่พบ (สิทธิ์ของแต่ละประเภทไม่เท่ากัน)
  if (!doc || SLUG_OF_TYPE[doc.type] !== kind.slug) notFound()

  const canVoid = doc.status === "POSTED" && (granted[kind.resource]?.includes("DELETE") ?? false)
  const isAdjust = doc.type === "ADJUST"
  const isReceipt = doc.type === "RECEIPT"

  return (
    <>
      <div className="page-head no-print">
        <div>
          <p className="t-eyebrow">
            <Link href={`/stock/${kind.slug}`} className="row" style={{ gap: 6, display: "inline-flex" }}>
              <IconBack size={14} aria-hidden />
              {kind.title}
            </Link>
          </p>
          <h1 className="t-h1 num">{doc.docNumber}</h1>
        </div>
        <StockDocActions id={doc.id} docNumber={doc.docNumber} canVoid={canVoid} voidHint={VOID_HINT[doc.type]} />
      </div>

      {doc.status === "VOIDED" ? (
        <div className="alert-banner danger no-print">
          ยกเลิกแล้วเมื่อ {doc.voidedAt ? formatDateTime(doc.voidedAt) : "—"} โดย {doc.voidedByName ?? "—"} — เหตุผล: {doc.voidReason ?? "—"}
        </div>
      ) : null}

      <article className="card-ui card-pad doc-print" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <header className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div>
            <p className="t-caption">{doc.storeName}</p>
            <h2 className="t-h2">{kind.title}</h2>
            {doc.status === "VOIDED" ? (
              <span className="chip chip-danger" style={{ marginTop: 6 }}>
                <span className="dot" />
                ยกเลิกแล้ว
              </span>
            ) : null}
          </div>
          <dl style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "4px 16px", fontSize: "0.875rem" }}>
            <dt className="t-caption">เลขที่</dt>
            <dd className="num" style={{ fontWeight: 600 }}>
              {doc.docNumber}
            </dd>
            <dt className="t-caption">วันที่</dt>
            <dd className="num">{formatBusinessDate(doc.docDate)}</dd>
            {isReceipt ? (
              <>
                <dt className="t-caption">ผู้ขาย</dt>
                <dd>{doc.supplierName ?? "—"}</dd>
                <dt className="t-caption">เลขที่ใบส่งของ</dt>
                <dd className="num">{doc.referenceNo ?? "—"}</dd>
              </>
            ) : null}
            {doc.type === "ISSUE" ? (
              <>
                <dt className="t-caption">ผู้เบิก</dt>
                <dd style={{ fontWeight: 600 }}>{doc.requesterName ?? "—"}</dd>
              </>
            ) : null}
            {isAdjust ? (
              <>
                <dt className="t-caption">เหตุผล</dt>
                <dd>{doc.reason ?? "—"}</dd>
              </>
            ) : null}
            <dt className="t-caption">ผู้บันทึก</dt>
            <dd>
              {doc.createdByName} <span className="t-caption num">· {formatDateTime(doc.createdAt)}</span>
            </dd>
          </dl>
        </header>

        <div className="datatable-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                <th style={{ ...head, width: 40 }}>#</th>
                <th style={head}>รหัส</th>
                <th style={head}>สินค้า</th>
                {isAdjust ? (
                  <>
                    <th style={numHead}>ในระบบ</th>
                    <th style={numHead}>นับได้</th>
                    <th style={numHead}>ส่วนต่าง</th>
                  </>
                ) : (
                  <th style={numHead}>จำนวน</th>
                )}
                <th style={head}>หน่วย</th>
                {isReceipt ? (
                  <>
                    <th style={numHead}>ราคาทุน/หน่วย</th>
                    <th style={numHead}>รวม</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((line) => (
                <tr key={line.lineNo} style={{ borderTop: "1px solid var(--line)" }}>
                  <td className="num t-caption" style={cell}>
                    {line.lineNo}
                  </td>
                  <td className="num" style={cell}>
                    {line.sku}
                  </td>
                  <td style={cell}>{line.name}</td>
                  {isAdjust ? (
                    <>
                      <td className="num" style={numCell}>
                        {formatNumber(line.systemQty ?? 0)}
                      </td>
                      <td className="num" style={numCell}>
                        {formatNumber(line.countedQty ?? 0)}
                      </td>
                      <td className="num" style={{ ...numCell, fontWeight: 600 }}>
                        {line.quantity === 0 ? "ตรง" : `${line.quantity > 0 ? "+" : "−"}${formatNumber(Math.abs(line.quantity))}`}
                      </td>
                    </>
                  ) : (
                    <td className="num" style={{ ...numCell, fontWeight: 600 }}>
                      {formatNumber(line.quantity)}
                    </td>
                  )}
                  <td style={cell}>{line.unit}</td>
                  {isReceipt ? (
                    <>
                      <td className="num" style={numCell}>
                        {line.unitCost === null ? "—" : formatBaht(line.unitCost)}
                      </td>
                      <td className="num" style={numCell}>
                        {line.lineTotal === null ? "—" : formatBaht(line.lineTotal)}
                      </td>
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
            {isReceipt && doc.totalCost !== null ? (
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--line)" }}>
                  <td colSpan={6} style={{ ...numCell, fontWeight: 600 }}>
                    มูลค่ารวม
                  </td>
                  <td className="num" style={{ ...numCell, fontWeight: 700 }}>
                    ฿{formatBaht(doc.totalCost)}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>

        {doc.note ? <p className="t-small">หมายเหตุ: {doc.note}</p> : null}

        {/* ช่องเซ็นชื่อ — มีความหมายเฉพาะตอนพิมพ์ออกมาเป็นกระดาษ */}
        <footer style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 32, marginTop: 24 }}>
          {SIGNATURES[doc.type].map((role) => (
            <div key={role} style={{ textAlign: "center" }}>
              <div style={{ borderBottom: "1px dotted var(--ink-3)", height: 40 }} />
              <p className="t-caption" style={{ marginTop: 6 }}>
                {role}
              </p>
            </div>
          ))}
        </footer>
      </article>
    </>
  )
}
