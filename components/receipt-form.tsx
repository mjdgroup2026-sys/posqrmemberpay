"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createStockReceipt, updateStockReceipt } from "@/app/actions/stock-docs"
import { formatBaht, formatNumber } from "@/lib/format"
import type { FieldErrors } from "@/lib/types"
import { ProductSearch, type StockDocProduct } from "@/components/product-search"
import { IconSave, IconSpinner, IconTrash, IconTruck } from "@/components/icons"

/// ฟอร์มใบรับสินค้าแบบตารางเดียว (Phase 21d) — ใช้ทั้งสร้างใบใหม่และกลับมารับเพิ่ม/แก้ใบที่ยังค้างรับ
///
/// ต่อบรรทัด: สั่ง · รับแล้ว · **รับครั้งนี้** · ค้างรับ · ราคาทุน · รวม + แถวรวมท้ายตาราง
/// · "บันทึก (ยังไม่รับของ)" = เก็บจำนวนสั่ง/ราคา ไม่แตะสต็อก
/// · "บันทึก + รับสินค้า" = บันทึก แล้วรับตามช่อง "รับครั้งนี้" เป็นรอบใหม่ในทรานแซคชันเดียว
///   ยังค้างรับ = ใบยังเปิด กลับมาหน้านี้รับเพิ่มได้ · ค้าง 0 = ใบปิดเอง
/// · ช่อง "รับครั้งนี้" ตั้งต้นเท่ายอดค้าง (ตามจำนวนสั่งไปเรื่อย ๆ จนกว่าผู้ใช้จะแก้เอง)
/// · ตัวเลขบนจอเป็นแค่ตัวช่วย ด่านจริง (ห้ามรับเกิน · บรรทัดที่รับแล้ว) อยู่ที่ `lib/stock-docs.ts`

export type ReceiptFormInitial = {
  id: string
  docNumber: string
  docDate: string
  supplierName: string | null
  referenceNo: string | null
  note: string | null
  lines: {
    lineId: string
    productId: string
    quantity: number
    unitCost: number | null
    receivedQty: number
    cancelledQty: number
    hasRounds: boolean
  }[]
}

type Line = {
  productId: string
  lineId?: string
  quantity: string
  unitCost: string
  /// ช่อง "รับครั้งนี้" — null = ผู้ใช้ยังไม่แตะ (โชว์ยอดค้างให้อัตโนมัติ)
  receiveQty: string | null
  receivedQty: number
  cancelledQty: number
  locked: boolean
}

const cell = { padding: "8px 12px" } as const
const numCell = { padding: "8px 12px", textAlign: "right" } as const
const head = { padding: "10px 12px", fontWeight: 500 } as const
const numHead = { padding: "10px 12px", fontWeight: 500, textAlign: "right" } as const

function toInt(value: string): number {
  const n = Number(value)
  return value !== "" && Number.isInteger(n) && n >= 0 ? n : 0
}

/// ยอดค้างก่อนรับครั้งนี้
function openQty(line: Line): number {
  return Math.max(toInt(line.quantity) - line.receivedQty - line.cancelledQty, 0)
}

function receiveNow(line: Line): number {
  return line.receiveQty === null ? openQty(line) : toInt(line.receiveQty)
}

export function ReceiptForm({
  products,
  today,
  prefill = [],
  initial,
}: {
  products: StockDocProduct[]
  today: string
  prefill?: { productId: string; quantity: number }[]
  initial?: ReceiptFormInitial
}) {
  const router = useRouter()
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const editing = initial !== undefined

  const [docDate, setDocDate] = useState(initial?.docDate ?? today)
  const [supplierName, setSupplierName] = useState(initial?.supplierName ?? "")
  const [referenceNo, setReferenceNo] = useState(initial?.referenceNo ?? "")
  const [note, setNote] = useState(initial?.note ?? "")
  const [receivedDate, setReceivedDate] = useState(today)
  const [roundReferenceNo, setRoundReferenceNo] = useState("")
  const [lines, setLines] = useState<Line[]>(() =>
    initial
      ? initial.lines.map((l) => ({
          productId: l.productId,
          lineId: l.lineId,
          quantity: String(l.quantity),
          unitCost: l.unitCost === null ? "" : String(l.unitCost),
          receiveQty: null,
          receivedQty: l.receivedQty,
          cancelledQty: l.cancelledQty,
          locked: l.hasRounds,
        }))
      : prefill
          .filter((p) => byId.has(p.productId))
          .map((p) => ({ productId: p.productId, quantity: String(p.quantity), unitCost: "", receiveQty: null, receivedQty: 0, cancelledQty: 0, locked: false })),
  )
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})

  function addProduct(productId: string) {
    if (!byId.has(productId) || lines.some((l) => l.productId === productId)) return
    setLines((prev) => [...prev, { productId, quantity: "1", unitCost: "", receiveQty: null, receivedQty: 0, cancelledQty: 0, locked: false }])
  }

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  const totals = lines.reduce(
    (sum, line) => {
      const ordered = toInt(line.quantity)
      const now = receiveNow(line)
      const cost = Number(line.unitCost)
      return {
        ordered: sum.ordered + ordered,
        received: sum.received + line.receivedQty,
        now: sum.now + now,
        left: sum.left + Math.max(openQty(line) - now, 0),
        value: sum.value + (line.unitCost !== "" && Number.isFinite(cost) ? cost * ordered : 0),
      }
    },
    { ordered: 0, received: 0, now: 0, left: 0, value: 0 },
  )
  const hasCost = lines.some((line) => line.unitCost !== "")
  const overReceive = lines.some((line) => receiveNow(line) > openQty(line))

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const mode = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? ""
    setPending(true)
    setErrors({})

    const formData = new FormData()
    if (editing) formData.set("id", initial.id)
    formData.set("mode", mode)
    formData.set("docDate", docDate)
    formData.set("supplierName", supplierName)
    formData.set("referenceNo", referenceNo)
    formData.set("note", note)
    formData.set("receivedDate", receivedDate)
    formData.set("roundReferenceNo", roundReferenceNo)
    formData.set(
      "lines",
      JSON.stringify(
        lines.map((line) => ({
          lineId: line.lineId ?? "",
          productId: line.productId,
          quantity: line.quantity,
          unitCost: line.unitCost,
          receiveQty: String(receiveNow(line)),
        })),
      ),
    )

    try {
      const result = await (editing ? updateStockReceipt : createStockReceipt)(formData)
      if (!result.ok) {
        toast.error(result.error)
        setErrors(result.fieldErrors ?? {})
        return
      }
      toast.success(result.message)
      router.push(result.data ? `/stock/receipts/${result.data.id}` : "/stock/receipts")
      router.refresh()
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section className="card-ui card-pad">
        <h2 className="t-h2" style={{ marginBottom: 16 }}>
          ข้อมูลใบรับ
        </h2>
        <div className="field-grid">
          <div className="field">
            <label className="t-small" htmlFor="docDate">
              วันที่เอกสาร <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            <input id="docDate" type="date" className="input num" value={docDate} max={today} required onChange={(e) => setDocDate(e.target.value)} />
            {errors.docDate ? <p className="field-hint error">{errors.docDate}</p> : null}
          </div>
          <div className="field">
            <label className="t-small" htmlFor="supplierName">
              ผู้ขาย / ร้านที่ซื้อ
            </label>
            <input id="supplierName" className="input" value={supplierName} maxLength={120} onChange={(e) => setSupplierName(e.target.value)} placeholder="เช่น แม็คโคร สาขา..." />
          </div>
          <div className="field">
            <label className="t-small" htmlFor="referenceNo">
              เลขที่อ้างอิง (ใบสั่งซื้อ)
            </label>
            <input id="referenceNo" className="input num" value={referenceNo} maxLength={60} onChange={(e) => setReferenceNo(e.target.value)} />
          </div>
          <div className="field">
            <label className="t-small" htmlFor="note">
              หมายเหตุ
            </label>
            <input id="note" className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <h3 className="t-h3" style={{ margin: "20px 0 12px" }}>
          การรับสินค้าครั้งนี้
        </h3>
        <div className="field-grid">
          <div className="field">
            <label className="t-small" htmlFor="receivedDate">
              วันที่รับสินค้า
            </label>
            <input id="receivedDate" type="date" className="input num" value={receivedDate} max={today} onChange={(e) => setReceivedDate(e.target.value)} />
            {errors.receivedDate ? <p className="field-hint error">{errors.receivedDate}</p> : null}
          </div>
          <div className="field">
            <label className="t-small" htmlFor="roundReferenceNo">
              เลขที่ใบส่งของ
            </label>
            <input id="roundReferenceNo" className="input num" value={roundReferenceNo} maxLength={60} onChange={(e) => setRoundReferenceNo(e.target.value)} />
          </div>
        </div>
        <p className="t-caption" style={{ marginTop: 8 }}>
          ใช้เฉพาะตอนกด &quot;บันทึก + รับสินค้า&quot; — ของยังมาไม่ครบก็รับเท่าที่ได้ ยอดที่เหลือค้างไว้ กลับมารับเพิ่มได้ภายหลัง
        </p>
      </section>

      <section className="card-ui">
        <div className="panel-head" style={{ flexWrap: "wrap", gap: 12 }}>
          <h2 className="t-h2">รายการสินค้า ({formatNumber(lines.length)})</h2>
          <ProductSearch products={products} excluded={new Set(lines.map((l) => l.productId))} onPick={addProduct} />
        </div>

        {lines.length === 0 ? (
          <p className="t-body" style={{ padding: 24 }}>
            ยังไม่มีรายการ — ค้นหาสินค้าด้านบนเพื่อเพิ่มลงใบรับ
          </p>
        ) : (
          <div className="datatable-wrap">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                  <th style={{ ...head, width: 36 }}>#</th>
                  <th style={head}>สินค้า</th>
                  <th style={numHead}>สั่ง</th>
                  <th style={numHead}>รับแล้ว</th>
                  <th style={numHead}>รับครั้งนี้</th>
                  <th style={numHead}>ค้างรับ</th>
                  <th style={numHead}>ราคาทุน/หน่วย</th>
                  <th style={numHead}>รวม</th>
                  <th style={{ ...head, width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const product = byId.get(line.productId)
                  if (!product) return null
                  const open = openQty(line)
                  const now = receiveNow(line)
                  const over = now > open
                  const left = Math.max(open - now, 0)
                  const ordered = toInt(line.quantity)
                  const floor = Math.max(line.receivedQty + line.cancelledQty, 1)
                  const lineError =
                    errors[`lines.${index}.quantity`] ?? errors[`lines.${index}.receiveQty`] ?? errors[`lines.${index}.productId`] ?? errors[`lines.${index}.unitCost`]
                  return (
                    <tr key={line.productId} style={{ borderTop: "1px solid var(--line)" }}>
                      <td className="num t-caption" style={cell}>
                        {index + 1}
                      </td>
                      <td style={cell}>
                        <div style={{ fontWeight: 500 }}>{product.name}</div>
                        <div className="t-caption num">
                          {product.sku} · คงเหลือ {formatNumber(product.quantity)} {product.unit}
                        </div>
                        {lineError ? <p className="field-hint error">{lineError}</p> : null}
                      </td>
                      <td style={numCell}>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={floor}
                          step={1}
                          required
                          className="input num"
                          style={{ width: 90, textAlign: "right" }}
                          aria-label={`จำนวนสั่ง ${product.name}`}
                          value={line.quantity}
                          onChange={(e) => updateLine(index, { quantity: e.target.value })}
                        />
                      </td>
                      <td className="num" style={{ ...numCell, color: line.receivedQty > 0 ? undefined : "var(--ink-3)" }}>
                        {formatNumber(line.receivedQty)}
                      </td>
                      <td style={numCell}>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={open}
                          step={1}
                          className="input num"
                          style={{ width: 90, textAlign: "right", borderColor: over ? "var(--danger)" : undefined }}
                          aria-label={`จำนวนรับครั้งนี้ ${product.name}`}
                          value={line.receiveQty ?? String(open)}
                          disabled={open === 0 && line.receiveQty === null}
                          onChange={(e) => updateLine(index, { receiveQty: e.target.value })}
                        />
                      </td>
                      <td className="num" style={{ ...numCell, fontWeight: 600, color: over ? "var(--danger)" : left > 0 ? "var(--warning)" : "var(--ink-3)" }}>
                        {over ? `เกิน ${formatNumber(now - open)}` : formatNumber(left)}
                        {line.cancelledQty > 0 ? <div className="t-caption">ยกเลิก {formatNumber(line.cancelledQty)}</div> : null}
                      </td>
                      <td style={numCell}>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          className="input num"
                          style={{ width: 100, textAlign: "right" }}
                          aria-label={`ราคาทุน ${product.name}`}
                          placeholder="ไม่ระบุ"
                          value={line.unitCost}
                          onChange={(e) => updateLine(index, { unitCost: e.target.value })}
                        />
                      </td>
                      <td className="num" style={numCell}>
                        {line.unitCost !== "" ? formatBaht(Number(line.unitCost) * ordered) : "—"}
                      </td>
                      <td style={cell}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          disabled={line.locked}
                          title={line.locked ? "มีประวัติรับแล้ว ลบไม่ได้" : undefined}
                          aria-label={`ลบ ${product.name} ออกจากใบรับ`}
                          onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                        >
                          <IconTrash size={16} aria-hidden />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 700 }}>
                  <td style={cell} />
                  <td style={cell}>รวม</td>
                  <td className="num" style={numCell}>
                    {formatNumber(totals.ordered)}
                  </td>
                  <td className="num" style={numCell}>
                    {formatNumber(totals.received)}
                  </td>
                  <td className="num" style={numCell}>
                    {formatNumber(totals.now)}
                  </td>
                  <td className="num" style={numCell}>
                    {formatNumber(totals.left)}
                  </td>
                  <td style={cell} />
                  <td className="num" style={numCell}>
                    {hasCost ? `฿${formatBaht(totals.value)}` : "—"}
                  </td>
                  <td style={cell} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {errors.lines ? (
          <p className="field-hint error" style={{ padding: "0 24px 16px" }}>
            {errors.lines}
          </p>
        ) : null}
      </section>

      <div className="row" style={{ justifyContent: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-ghost" onClick={() => router.push(editing ? `/stock/receipts/${initial.id}` : "/stock/receipts")}>
          ยกเลิก
        </button>
        <button type="submit" value="draft" className="btn btn-subtle btn-lg" disabled={pending || lines.length === 0}>
          {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : <IconSave size={17} aria-hidden />}
          บันทึก (ยังไม่รับของ)
        </button>
        <button type="submit" value="receive" className="btn btn-primary btn-lg" disabled={pending || lines.length === 0 || totals.now === 0 || overReceive}>
          {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : <IconTruck size={17} aria-hidden />}
          บันทึก + รับสินค้า ({formatNumber(totals.now)})
        </button>
      </div>
    </form>
  )
}
