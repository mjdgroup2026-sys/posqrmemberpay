import Link from "next/link"
import { notFound } from "next/navigation"
import { getStockDocument, type StockDocDetail } from "@/lib/queries"
import { requirePageAccess } from "@/lib/permissions"
import { DOC_STATUS_CHIP, isOpenReceipt, SLUG_OF_TYPE, stockDocKind } from "@/lib/stock-doc-kinds"
import { formatBaht, formatBusinessDate, formatDateTime, formatNumber } from "@/lib/format"
import { StockDocActions } from "@/components/stock-doc-actions"
import { ReceiptLineButtons, ReceiptToolbar, VoidRoundButton } from "@/components/receipt-actions"
import { IconBack } from "@/components/icons"

export const metadata = { title: "เอกสารคลัง" }

const VOID_HINT = {
  RECEIPT: "ระบบจะยกเลิกทุกรอบที่รับแล้ว โดยตัดของออกจากสต็อกด้วยรายการชดเชย — ถ้าของถูกขาย/เบิกไปจนเหลือไม่พอ จะยกเลิกไม่ได้ทั้งใบ",
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
const tableStyle = { width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" } as const
const headRow = { textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" } as const

/// ดู/พิมพ์เอกสารคลัง (Phase 21 · F30)
/// · ใบเบิก/ใบปรับแก้ไม่ได้ ยกเลิกได้อย่างเดียว
/// · ใบรับ (21d) ยังค้างรับ = แก้ไข / รับสินค้าเป็นรอบ / ยกเลิกยอดค้างรายบรรทัด / ปิดใบ · ยกเลิกได้รายรอบหรือทั้งใบ
export default async function StockDocDetailPage({ params }: PageProps<"/stock/[kind]/[id]">) {
  const { kind: slug, id } = await params
  const kind = stockDocKind(slug)
  if (!kind) notFound()
  const { storeId, granted } = await requirePageAccess(kind.resource)

  const doc = await getStockDocument(storeId, id)
  // เอกสารประเภทอื่นที่ถูกเปิดผ่าน URL ของอีกประเภท = ไม่พบ (สิทธิ์ของแต่ละประเภทไม่เท่ากัน)
  if (!doc || SLUG_OF_TYPE[doc.type] !== kind.slug) notFound()

  const isAdjust = doc.type === "ADJUST"
  const isReceipt = doc.type === "RECEIPT"
  const canAdd = granted[kind.resource]?.includes("ADD") ?? false
  const canDelete = granted[kind.resource]?.includes("DELETE") ?? false
  const canVoid = canDelete && (isReceipt ? doc.status !== "VOIDED" : doc.status === "POSTED")
  const open = isReceipt && isOpenReceipt(doc.status)
  const chip = DOC_STATUS_CHIP[doc.status]

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
        <StockDocActions id={doc.id} docNumber={doc.docNumber} canVoid={canVoid} voidHint={VOID_HINT[doc.type]}>
          {isReceipt ? (
            <ReceiptToolbar
              documentId={doc.id}
              docNumber={doc.docNumber}
              receiveHref={`/stock/${kind.slug}/${doc.id}/edit`}
              canAdd={open && canAdd}
            />
          ) : null}
        </StockDocActions>
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
            {isReceipt || doc.status === "VOIDED" ? (
              <span className={`chip chip-${chip.tone}`} style={{ marginTop: 6 }}>
                <span className="dot" />
                {chip.label}
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
                <dt className="t-caption">เลขที่อ้างอิง</dt>
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

        {isReceipt ? <ReceiptLines doc={doc} canAdd={canAdd} /> : <MoveLines doc={doc} />}

        {doc.note ? <p className="t-small">หมายเหตุ: {doc.note}</p> : null}

        {isReceipt ? <ReceiptRounds doc={doc} canVoidRound={canDelete && doc.status !== "VOIDED"} /> : null}

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

type DocLine = StockDocDetail["lines"][number]

function remainingOf(line: DocLine): number {
  return Math.max(line.quantity - line.receivedQty - line.cancelledQty, 0)
}

function sumOf(lines: DocLine[], pick: (line: DocLine) => number): number {
  return lines.reduce((sum, line) => sum + pick(line), 0)
}

/// ใบเบิก / ใบปรับ
function MoveLines({ doc }: { doc: StockDocDetail }) {
  const isAdjust = doc.type === "ADJUST"
  return (
    <div className="datatable-wrap">
      <table style={tableStyle}>
        <thead>
          <tr style={headRow}>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/// ใบรับ (21d): สั่ง · รับแล้ว · ยกเลิก · ค้าง + ปุ่มยกเลิก/คืนยอดค้างต่อบรรทัด
function ReceiptLines({ doc, canAdd }: { doc: StockDocDetail; canAdd: boolean }) {
  const voided = doc.status === "VOIDED"
  const showButtons = canAdd && !voided
  return (
    <div className="datatable-wrap">
      <table style={tableStyle}>
        <thead>
          <tr style={headRow}>
            <th style={{ ...head, width: 40 }}>#</th>
            <th style={head}>สินค้า</th>
            <th style={numHead}>สั่ง</th>
            <th style={numHead}>รับแล้ว</th>
            <th style={numHead}>ยกเลิก</th>
            <th style={numHead}>ค้างรับ</th>
            <th style={head}>หน่วย</th>
            <th style={numHead}>ราคาทุน/หน่วย</th>
            <th style={numHead}>รวม</th>
            {showButtons ? <th className="no-print" style={head} /> : null}
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((line) => {
            const remaining = remainingOf(line)
            return (
              <tr key={line.id} style={{ borderTop: "1px solid var(--line)" }}>
                <td className="num t-caption" style={cell}>
                  {line.lineNo}
                </td>
                <td style={cell}>
                  <div style={{ fontWeight: 500 }}>{line.name}</div>
                  <div className="t-caption num">{line.sku}</div>
                  {line.cancelledQty > 0 && line.cancelReason ? <div className="t-caption">ยกเลิก: {line.cancelReason}</div> : null}
                </td>
                <td className="num" style={numCell}>
                  {formatNumber(line.quantity)}
                </td>
                <td className="num" style={{ ...numCell, fontWeight: 600 }}>
                  {formatNumber(line.receivedQty)}
                </td>
                <td className="num" style={{ ...numCell, color: line.cancelledQty > 0 ? "var(--danger)" : "var(--ink-3)" }}>
                  {line.cancelledQty > 0 ? formatNumber(line.cancelledQty) : "—"}
                </td>
                <td className="num" style={{ ...numCell, fontWeight: remaining > 0 ? 600 : 400, color: remaining > 0 ? "var(--warning)" : "var(--ink-3)" }}>
                  {voided ? "—" : formatNumber(remaining)}
                </td>
                <td style={cell}>{line.unit}</td>
                <td className="num" style={numCell}>
                  {line.unitCost === null ? "—" : formatBaht(line.unitCost)}
                </td>
                <td className="num" style={numCell}>
                  {line.lineTotal === null ? "—" : formatBaht(line.lineTotal)}
                </td>
                {showButtons ? (
                  <td className="no-print" style={cell}>
                    <ReceiptLineButtons
                      lineId={line.id}
                      name={line.name}
                      unit={line.unit}
                      remaining={remaining}
                      cancelledQty={line.cancelledQty}
                      canCancel
                      canRestore
                    />
                  </td>
                ) : null}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 700 }}>
            <td style={cell} />
            <td style={cell}>รวม</td>
            <td className="num" style={numCell}>
              {formatNumber(sumOf(doc.lines, (line) => line.quantity))}
            </td>
            <td className="num" style={numCell}>
              {formatNumber(sumOf(doc.lines, (line) => line.receivedQty))}
            </td>
            <td className="num" style={numCell}>
              {formatNumber(sumOf(doc.lines, (line) => line.cancelledQty))}
            </td>
            <td className="num" style={numCell}>
              {voided ? "—" : formatNumber(sumOf(doc.lines, remainingOf))}
            </td>
            <td style={cell} />
            <td style={cell} />
            <td className="num" style={numCell}>
              {doc.totalCost === null ? "—" : `฿${formatBaht(doc.totalCost)}`}
            </td>
            {showButtons ? <td className="no-print" /> : null}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/// ประวัติรอบรับ (21d) — รอบที่ยกเลิกแล้วยังโชว์ (ขีดฆ่า) เป็นหลักฐาน
function ReceiptRounds({ doc, canVoidRound }: { doc: StockDocDetail; canVoidRound: boolean }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h3 className="t-h3">ประวัติการรับสินค้า</h3>
      {doc.rounds.length === 0 ? (
        <p className="t-small" style={{ color: "var(--ink-3)" }}>
          ยังไม่ได้รับสินค้า — กด &quot;รับสินค้า / แก้ไข&quot; เมื่อของมาถึง
        </p>
      ) : (
        doc.rounds.map((round) => {
          const voided = round.status === "VOIDED"
          return (
            <div key={round.id} className="card-ui card-pad" style={{ display: "flex", flexDirection: "column", gap: 8, opacity: voided ? 0.7 : 1 }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                  <strong className="num">รอบที่ {round.roundNo}</strong>
                  <span className="num">{formatBusinessDate(round.receivedDate)}</span>
                  {round.referenceNo ? <span className="t-small num">ใบส่งของ {round.referenceNo}</span> : null}
                  {voided ? (
                    <span className="chip chip-danger">
                      <span className="dot" />
                      ยกเลิกแล้ว
                    </span>
                  ) : null}
                </div>
                {canVoidRound && !voided ? <VoidRoundButton roundId={round.id} label={` ${doc.docNumber} รอบที่ ${round.roundNo}`} /> : null}
              </div>
              <p className="t-small" style={{ textDecoration: voided ? "line-through" : undefined }}>
                {round.lines.map((line) => `${line.name} ${formatNumber(line.quantity)} ${line.unit}`).join(" · ")}
              </p>
              <p className="t-caption">
                บันทึกโดย {round.createdByName} · {formatDateTime(round.createdAt)}
                {round.note ? ` · ${round.note}` : ""}
                {voided ? ` · ยกเลิกโดย ${round.voidedByName ?? "—"}${round.voidedAt ? ` ${formatDateTime(round.voidedAt)}` : ""} — ${round.voidReason ?? "—"}` : ""}
              </p>
            </div>
          )
        })
      )}
    </section>
  )
}
