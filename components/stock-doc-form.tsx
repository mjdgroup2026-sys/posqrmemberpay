"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createStockAdjustment, createStockIssue, createStockReceipt } from "@/app/actions/stock-docs"
import { STOCK_DOC_KINDS, type StockDocSlug } from "@/lib/stock-doc-kinds"
import { formatBaht, formatNumber } from "@/lib/format"
import type { FieldErrors } from "@/lib/types"
import { IconPlus, IconSearch, IconSpinner, IconTrash } from "@/components/icons"

/// ฟอร์มเอกสารคลังแบบหัว + บรรทัด (Phase 21 · F30) — ใช้ร่วมกันทั้งใบรับ / ใบเบิก / ใบปรับ
///
/// ช่องที่ต่างกันตามประเภท: ใบรับมีผู้ขาย/เลขใบส่งของ/ราคาทุน · ใบเบิกมีผู้เบิก (บังคับ) · ใบปรับมีเหตุผล + ยอดที่นับได้
/// · ยอดคงเหลือที่โชว์เป็นแค่ข้อมูลช่วยกรอก ด่านจริง (กันเบิกเกิน/คิดส่วนต่าง) อยู่ที่ server ใน `lib/stock-docs.ts`

export type StockDocProduct = {
  id: string
  sku: string
  name: string
  unit: string
  quantity: number
  category: string
}

export type StockDocPrefill = { productId: string; quantity: number }

type Line = { productId: string; quantity: string; unitCost: string }

const ADJUST_REASONS = ["นับสต็อกประจำงวด", "ของเสีย/หมดอายุ", "ของหาย", "คีย์ผิดก่อนหน้า"]

export function StockDocForm({
  kind: slug,
  products,
  today,
  prefill = [],
}: {
  kind: StockDocSlug
  products: StockDocProduct[]
  today: string
  prefill?: StockDocPrefill[]
}) {
  const kind = STOCK_DOC_KINDS[slug]
  const router = useRouter()
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const [docDate, setDocDate] = useState(today)
  const [supplierName, setSupplierName] = useState("")
  const [referenceNo, setReferenceNo] = useState("")
  const [requesterName, setRequesterName] = useState("")
  const [reason, setReason] = useState(kind.type === "ADJUST" ? ADJUST_REASONS[0] : "")
  const [note, setNote] = useState("")
  const [lines, setLines] = useState<Line[]>(() =>
    prefill
      .filter((p) => byId.has(p.productId))
      .map((p) => ({ productId: p.productId, quantity: String(p.quantity), unitCost: "" })),
  )
  const [search, setSearch] = useState("")
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})

  const inDoc = new Set(lines.map((l) => l.productId))
  const term = search.trim().toLowerCase()
  const matches = term
    ? products.filter((p) => !inDoc.has(p.id) && (p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term))).slice(0, 8)
    : []

  function addProduct(productId: string) {
    const product = byId.get(productId)
    if (!product || inDoc.has(productId)) return
    // ใบปรับตั้งต้นที่ยอดในระบบ ผู้ใช้แก้เป็นยอดที่นับได้ · ใบรับ/เบิกตั้งต้นที่ 1
    setLines((prev) => [...prev, { productId, quantity: kind.type === "ADJUST" ? String(product.quantity) : "1", unitCost: "" }])
    setSearch("")
  }

  /// สแกนบาร์โค้ด/พิมพ์ SKU แล้วกด Enter = เพิ่มทันทีถ้าตรงตัว (หรือเหลือตัวเลือกเดียว)
  function onSearchEnter() {
    const exact = products.find((p) => p.sku.toLowerCase() === term && !inDoc.has(p.id))
    const pick = exact ?? (matches.length === 1 ? matches[0] : null)
    if (pick) addProduct(pick.id)
  }

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  const totalCost = lines.reduce((sum, line) => {
    const cost = Number(line.unitCost)
    const qty = Number(line.quantity)
    return line.unitCost !== "" && Number.isFinite(cost) && Number.isFinite(qty) ? sum + cost * qty : sum
  }, 0)
  const hasCost = lines.some((line) => line.unitCost !== "")

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setErrors({})

    const formData = new FormData()
    formData.set("docDate", docDate)
    formData.set("note", note)
    if (kind.type === "RECEIPT") {
      formData.set("supplierName", supplierName)
      formData.set("referenceNo", referenceNo)
    }
    if (kind.type === "ISSUE") formData.set("requesterName", requesterName)
    if (kind.type === "ADJUST") formData.set("reason", reason)
    formData.set(
      "lines",
      JSON.stringify(
        lines.map((line) =>
          kind.type === "ADJUST"
            ? { productId: line.productId, countedQty: line.quantity }
            : kind.type === "RECEIPT"
              ? { productId: line.productId, quantity: line.quantity, unitCost: line.unitCost }
              : { productId: line.productId, quantity: line.quantity },
        ),
      ),
    )

    const action = kind.type === "RECEIPT" ? createStockReceipt : kind.type === "ISSUE" ? createStockIssue : createStockAdjustment
    try {
      const result = await action(formData)
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

  const qtyLabel = kind.type === "ADJUST" ? "นับได้จริง" : kind.type === "RECEIPT" ? "จำนวนรับ" : "จำนวนเบิก"

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

          {kind.type === "RECEIPT" ? (
            <>
              <div className="field">
                <label className="t-small" htmlFor="supplierName">
                  ผู้ขาย / ร้านที่ซื้อ
                </label>
                <input id="supplierName" className="input" value={supplierName} maxLength={120} onChange={(e) => setSupplierName(e.target.value)} placeholder="เช่น แม็คโคร สาขา..." />
              </div>
              <div className="field">
                <label className="t-small" htmlFor="referenceNo">
                  เลขที่ใบกำกับ / ใบส่งของ
                </label>
                <input id="referenceNo" className="input num" value={referenceNo} maxLength={60} onChange={(e) => setReferenceNo(e.target.value)} />
              </div>
            </>
          ) : null}

          {kind.type === "ISSUE" ? (
            <div className="field">
              <label className="t-small" htmlFor="requesterName">
                ชื่อผู้เบิก <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input id="requesterName" className="input" value={requesterName} maxLength={80} required onChange={(e) => setRequesterName(e.target.value)} placeholder="เช่น ครัว — สมชาย" />
              {errors.requesterName ? <p className="field-hint error">{errors.requesterName}</p> : null}
            </div>
          ) : null}

          {kind.type === "ADJUST" ? (
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
          ) : null}

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
          <div style={{ position: "relative", minWidth: 280, flex: "0 1 360px" }}>
            <div className="row" style={{ gap: 8 }}>
              <IconSearch size={16} aria-hidden style={{ color: "var(--ink-3)" }} />
              <input
                className="input"
                aria-label="ค้นหาสินค้าด้วยชื่อหรือ SKU"
                placeholder="ค้นหาชื่อ / สแกนบาร์โค้ด (SKU) แล้วกด Enter"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    onSearchEnter()
                  }
                }}
              />
            </div>
            {matches.length > 0 ? (
              <ul
                role="listbox"
                className="card-ui"
                style={{ position: "absolute", zIndex: 20, left: 0, right: 0, top: "calc(100% + 4px)", maxHeight: 280, overflowY: "auto" }}
              >
                {matches.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="row"
                      onClick={() => addProduct(p.id)}
                      style={{ width: "100%", justifyContent: "space-between", padding: "10px 14px", textAlign: "left", gap: 12 }}
                    >
                      <span>
                        <span style={{ fontWeight: 500 }}>{p.name}</span> <span className="t-caption num">({p.sku})</span>
                      </span>
                      <span className="t-caption num">
                        คงเหลือ {formatNumber(p.quantity)} {p.unit}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
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
                  {kind.type === "RECEIPT" ? (
                    <>
                      <th style={{ padding: "10px 16px", fontWeight: 500, textAlign: "right" }}>ราคาทุน/หน่วย</th>
                      <th style={{ padding: "10px 16px", fontWeight: 500, textAlign: "right" }}>รวม</th>
                    </>
                  ) : null}
                  {kind.type === "ADJUST" ? <th style={{ padding: "10px 16px", fontWeight: 500, textAlign: "right" }}>ส่วนต่าง</th> : null}
                  {kind.type === "ISSUE" ? <th style={{ padding: "10px 16px", fontWeight: 500, textAlign: "right" }}>คงเหลือหลังเบิก</th> : null}
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
                          min={kind.type === "ADJUST" ? 0 : 1}
                          step={1}
                          required
                          className="input num"
                          style={{ width: 110, textAlign: "right" }}
                          aria-label={`${qtyLabel} ${product.name}`}
                          value={line.quantity}
                          onChange={(e) => updateLine(index, { quantity: e.target.value })}
                        />
                      </td>
                      {kind.type === "RECEIPT" ? (
                        <>
                          <td style={{ padding: "8px 16px", textAlign: "right" }}>
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="0.01"
                              className="input num"
                              style={{ width: 120, textAlign: "right" }}
                              aria-label={`ราคาทุน ${product.name}`}
                              placeholder="ไม่ระบุ"
                              value={line.unitCost}
                              onChange={(e) => updateLine(index, { unitCost: e.target.value })}
                            />
                          </td>
                          <td className="num" style={{ padding: "8px 16px", textAlign: "right" }}>
                            {line.unitCost !== "" && qtyValid ? `฿${formatBaht(Number(line.unitCost) * qty)}` : "—"}
                          </td>
                        </>
                      ) : null}
                      {kind.type === "ADJUST" ? (
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
                      ) : null}
                      {kind.type === "ISSUE" ? (
                        <td
                          className="num"
                          style={{ padding: "8px 16px", textAlign: "right", color: after !== null && after < 0 ? "var(--danger)" : undefined }}
                        >
                          {after === null ? "—" : after < 0 ? `ไม่พอ (ขาด ${formatNumber(-after)})` : formatNumber(after)}
                        </td>
                      ) : null}
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
              {kind.type === "RECEIPT" && hasCost ? (
                <tfoot>
                  <tr style={{ borderTop: "1px solid var(--line)" }}>
                    <td colSpan={5} style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600 }}>
                      มูลค่ารวม (เฉพาะบรรทัดที่กรอกราคาทุน)
                    </td>
                    <td className="num" style={{ padding: "10px 16px", textAlign: "right", fontWeight: 700 }}>
                      ฿{formatBaht(totalCost)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              ) : null}
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
