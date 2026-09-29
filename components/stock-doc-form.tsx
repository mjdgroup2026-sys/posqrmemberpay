"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createStockAdjustment, createStockIssue } from "@/app/actions/stock-docs"
import { STOCK_DOC_KINDS } from "@/lib/stock-doc-kinds"
import { formatNumber } from "@/lib/format"
import type { FieldErrors } from "@/lib/types"
import { ProductSearch, type StockDocProduct } from "@/components/product-search"
import { IconPlus, IconSpinner, IconTrash } from "@/components/icons"

export type { StockDocProduct } from "@/components/product-search"

/// ฟอร์มใบเบิก / ใบปรับยอด แบบหัว + บรรทัด (Phase 21 · F30) — ใบรับแยกไปที่ `receipt-form.tsx` (21d ตารางเดียว สั่ง/รับ/ค้างรับ)
///
/// ใบเบิกมีผู้เบิก (บังคับ) · ใบปรับมีเหตุผล + ยอดที่นับได้
/// · ยอดคงเหลือที่โชว์เป็นแค่ข้อมูลช่วยกรอก ด่านจริง (กันเบิกเกิน/คิดส่วนต่าง) อยู่ที่ server ใน `lib/stock-docs.ts`

export type StockDocPrefill = { productId: string; quantity: number }

type Line = { productId: string; quantity: string }

const ADJUST_REASONS = ["นับสต็อกประจำงวด", "ของเสีย/หมดอายุ", "ของหาย", "คีย์ผิดก่อนหน้า"]

export function StockDocForm({
  kind: slug,
  products,
  today,
}: {
  kind: "issues" | "adjustments"
  products: StockDocProduct[]
  today: string
}) {
  const kind = STOCK_DOC_KINDS[slug]
  const isAdjust = kind.type === "ADJUST"
  const router = useRouter()
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const [docDate, setDocDate] = useState(today)
  const [requesterName, setRequesterName] = useState("")
  const [reason, setReason] = useState(isAdjust ? ADJUST_REASONS[0] : "")
  const [note, setNote] = useState("")
  const [lines, setLines] = useState<Line[]>([])
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})

  function addProduct(productId: string) {
    const product = byId.get(productId)
    if (!product || lines.some((l) => l.productId === productId)) return
    // ใบปรับตั้งต้นที่ยอดในระบบ ผู้ใช้แก้เป็นยอดที่นับได้ · ใบเบิกตั้งต้นที่ 1
    setLines((prev) => [...prev, { productId, quantity: isAdjust ? String(product.quantity) : "1" }])
  }

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setErrors({})

    const formData = new FormData()
    formData.set("docDate", docDate)
    formData.set("note", note)
    if (isAdjust) formData.set("reason", reason)
    else formData.set("requesterName", requesterName)
    formData.set(
      "lines",
      JSON.stringify(
        lines.map((line) => (isAdjust ? { productId: line.productId, countedQty: line.quantity } : { productId: line.productId, quantity: line.quantity })),
      ),
    )

    try {
      const result = await (isAdjust ? createStockAdjustment : createStockIssue)(formData)
      if (!result.ok) {
        toast.error(result.error)
        setErrors(result.fieldErrors ?? {})
        return
      }
      toast.success(result.message)
      router.push(result.data ? `/stock/${kind.slug}/${result.data.id}` : `/stock/${kind.slug}`)
      router.refresh()
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  const qtyLabel = isAdjust ? "นับได้จริง" : "จำนวนเบิก"

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section className="card-ui card-pad">
        <h2 className="t-h2" style={{ marginBottom: 16 }}>
          ข้อมูลเอกสาร
        </h2>
        <div className="field-grid">
          <div className="field">
            <label className="t-small" htmlFor="docDate">
              วันที่เอกสาร <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            <input id="docDate" type="date" className="input num" value={docDate} max={today} required onChange={(e) => setDocDate(e.target.value)} />
            {errors.docDate ? <p className="field-hint error">{errors.docDate}</p> : null}
          </div>

          {isAdjust ? (
            <div className="field">
              <label className="t-small" htmlFor="reason">
                เหตุผลการปรับยอด <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input id="reason" className="input" list="adjust-reasons" value={reason} maxLength={120} required onChange={(e) => setReason(e.target.value)} />
              <datalist id="adjust-reasons">
                {ADJUST_REASONS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              {errors.reason ? <p className="field-hint error">{errors.reason}</p> : null}
            </div>
          ) : (
            <div className="field">
              <label className="t-small" htmlFor="requesterName">
                ชื่อผู้เบิก <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input id="requesterName" className="input" value={requesterName} maxLength={80} required onChange={(e) => setRequesterName(e.target.value)} placeholder="เช่น ครัว — สมชาย" />
              {errors.requesterName ? <p className="field-hint error">{errors.requesterName}</p> : null}
            </div>
          )}

          <div className="field">
            <label className="t-small" htmlFor="note">
              หมายเหตุ
            </label>
            <input id="note" className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="card-ui">
        <div className="panel-head" style={{ flexWrap: "wrap", gap: 12 }}>
          <h2 className="t-h2">รายการสินค้า ({formatNumber(lines.length)})</h2>
          <ProductSearch products={products} excluded={new Set(lines.map((l) => l.productId))} onPick={addProduct} />
        </div>

        {lines.length === 0 ? (
          <p className="t-body" style={{ padding: 24 }}>
            ยังไม่มีรายการ — ค้นหาสินค้าด้านบนเพื่อเพิ่มลงเอกสาร
          </p>
        ) : (
          <div className="datatable-wrap">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                  <th style={{ padding: "10px 16px", fontWeight: 500, width: 40 }}>#</th>
                  <th style={{ padding: "10px 16px", fontWeight: 500 }}>สินค้า</th>
                  <th style={{ padding: "10px 16px", fontWeight: 500, textAlign: "right" }}>คงเหลือในระบบ</th>
                  <th style={{ padding: "10px 16px", fontWeight: 500, textAlign: "right" }}>{qtyLabel}</th>
                  <th style={{ padding: "10px 16px", fontWeight: 500, textAlign: "right" }}>{isAdjust ? "ส่วนต่าง" : "คงเหลือหลังเบิก"}</th>
                  <th style={{ padding: "10px 16px", width: 48 }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const product = byId.get(line.productId)
                  if (!product) return null
                  const qty = Number(line.quantity)
                  const qtyValid = line.quantity !== "" && Number.isInteger(qty)
                  const diff = qtyValid ? qty - product.quantity : null
                  const after = qtyValid ? product.quantity - qty : null
                  const lineError = errors[`lines.${index}.quantity`] ?? errors[`lines.${index}.countedQty`] ?? errors[`lines.${index}.productId`]
                  return (
                    <tr key={line.productId} style={{ borderTop: "1px solid var(--line)" }}>
                      <td className="num t-caption" style={{ padding: "8px 16px" }}>
                        {index + 1}
                      </td>
                      <td style={{ padding: "8px 16px" }}>
                        <div style={{ fontWeight: 500 }}>{product.name}</div>
                        <div className="t-caption num">
                          {product.sku} · {product.category}
                        </div>
                        {lineError ? <p className="field-hint error">{lineError}</p> : null}
                      </td>
                      <td className="num" style={{ padding: "8px 16px", textAlign: "right" }}>
                        {formatNumber(product.quantity)} {product.unit}
                      </td>
                      <td style={{ padding: "8px 16px", textAlign: "right" }}>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={isAdjust ? 0 : 1}
                          step={1}
                          required
                          className="input num"
                          style={{ width: 110, textAlign: "right" }}
                          aria-label={`${qtyLabel} ${product.name}`}
                          value={line.quantity}
                          onChange={(e) => updateLine(index, { quantity: e.target.value })}
                        />
                      </td>
                      {isAdjust ? (
                        <td
                          className="num"
                          style={{
                            padding: "8px 16px",
                            textAlign: "right",
                            fontWeight: 600,
                            color: diff === null || diff === 0 ? "var(--ink-3)" : diff > 0 ? "var(--success)" : "var(--danger)",
                          }}
                        >
                          {diff === null ? "—" : diff === 0 ? "ตรง" : `${diff > 0 ? "+" : "−"}${formatNumber(Math.abs(diff))}`}
                        </td>
                      ) : (
                        <td
                          className="num"
                          style={{ padding: "8px 16px", textAlign: "right", color: after !== null && after < 0 ? "var(--danger)" : undefined }}
                        >
                          {after === null ? "—" : after < 0 ? `ไม่พอ (ขาด ${formatNumber(-after)})` : formatNumber(after)}
                        </td>
                      )}
                      <td style={{ padding: "8px 16px" }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          aria-label={`ลบ ${product.name} ออกจากเอกสาร`}
                          onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                        >
                          <IconTrash size={16} aria-hidden />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {errors.lines ? (
          <p className="field-hint error" style={{ padding: "0 24px 16px" }}>
            {errors.lines}
          </p>
        ) : null}
      </section>

      <div className="row" style={{ justifyContent: "flex-end", gap: 12 }}>
        <button type="button" className="btn btn-ghost" onClick={() => router.push(`/stock/${kind.slug}`)}>
          ยกเลิก
        </button>
        <button type="submit" className="btn btn-primary btn-lg" disabled={pending || lines.length === 0}>
          {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : <IconPlus size={17} aria-hidden />}
          บันทึก{kind.title}
        </button>
      </div>
    </form>
  )
}
