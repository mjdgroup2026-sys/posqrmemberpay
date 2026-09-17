"use client"

import { useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createSale } from "@/app/actions/sales"
import { buildStorePromptPayQr, type StorePromptPayQr } from "@/app/actions/staff-order"
import { formatBaht, formatNumber } from "@/lib/format"
import type { ProductOption } from "@/lib/queries"
import {
  FULL_ACCESS,
  PAYMENT_METHOD_LABEL,
  RETAIL_PAYMENT_METHODS,
  type AllowedActions,
  type FieldErrors,
  type PaymentMethodValue,
  type ReceiptData,
} from "@/lib/types"
import { Receipt } from "@/components/receipt"
import { IconPlus, IconSearch, IconSpinner, IconTrash, IconWallet } from "@/components/icons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type CartLine = {
  productId: string
  quantity: number
}

// PROMPTPAY/CARD เป็นของช่องทาง MJD Mobile Order เท่านั้น จึงไม่โผล่บนหน้าขายหน้าร้าน (Phase 10)
const PAYMENT_METHODS: readonly PaymentMethodValue[] = RETAIL_PAYMENT_METHODS

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function PosTerminal({
  products,
  categories,
  allowed = FULL_ACCESS,
}: {
  products: ProductOption[]
  categories: { id: string; name: string }[]
  /// สิทธิ์บน POS — ADD = ทำการขาย/ชำระเงิน (§4) · ไม่มี = ดูสินค้า/สต็อกได้แต่ปุ่มชำระเงินปิด
  allowed?: AllowedActions
}) {
  const router = useRouter()
  const searchRef = useRef<HTMLInputElement>(null)

  const [search, setSearch] = useState("")
  const [categoryId, setCategoryId] = useState("all")
  const [cart, setCart] = useState<CartLine[]>([])
  const [discountText, setDiscountText] = useState("")
  const [note, setNote] = useState("")

  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodValue>("CASH")
  const [receivedText, setReceivedText] = useState("")
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  /// QR พร้อมเพย์ของร้านตามยอดสุทธิ — ขอตอนเลือก "สแกน QR" (2026-09-17)
  const [qr, setQr] = useState<StorePromptPayQr | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)

  async function loadQr(amount: number) {
    setQr(null)
    setQrError(null)
    const fd = new FormData()
    fd.set("amount", String(amount))
    const result = await buildStorePromptPayQr(fd)
    if (result.ok && result.data) setQr(result.data)
    else setQrError(result.ok ? "สร้าง QR ไม่สำเร็จ" : result.error)
  }

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const visibleProducts = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return products.filter((p) => {
      if (categoryId !== "all" && p.categoryId !== categoryId) return false
      if (!keyword) return true
      return p.name.toLowerCase().includes(keyword) || p.sku.toLowerCase().includes(keyword)
    })
  }, [products, search, categoryId])

  const lines = useMemo(
    () =>
      cart.flatMap((line) => {
        const product = byId.get(line.productId)
        if (!product) return []
        return [
          {
            ...line,
            product,
            subtotal: round2(product.price * line.quantity),
            overStock: line.quantity > product.quantity,
          },
        ]
      }),
    [cart, byId],
  )

  const subtotal = round2(lines.reduce((sum, l) => sum + l.subtotal, 0))
  const discount = Number(discountText === "" ? 0 : discountText)
  const validDiscount = Number.isFinite(discount) && discount >= 0 && discount <= subtotal
  const total = round2(subtotal - (validDiscount ? discount : 0))
  const received = Number(receivedText === "" ? 0 : receivedText)
  const changeDue = paymentMethod === "CASH" ? round2(received - total) : 0
  const hasOverStock = lines.some((l) => l.overStock)

  function addToCart(productId: string, quantity = 1) {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === productId)
      if (existing) {
        return prev.map((l) => (l.productId === productId ? { ...l, quantity: l.quantity + quantity } : l))
      }
      return [...prev, { productId, quantity }]
    })
  }

  function setQuantity(productId: string, quantity: number) {
    if (quantity <= 0) {
      setCart((prev) => prev.filter((l) => l.productId !== productId))
      return
    }
    setCart((prev) => prev.map((l) => (l.productId === productId ? { ...l, quantity } : l)))
  }

  /// ค้นหาแล้วกด Enter = เพิ่มลงตะกร้าทันที — รองรับเครื่องอ่านบาร์โค้ดแบบ keyboard-wedge
  function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const keyword = search.trim().toLowerCase()
    if (!keyword) return

    const exact = products.find((p) => p.sku.toLowerCase() === keyword)
    const target = exact ?? (visibleProducts.length === 1 ? visibleProducts[0] : undefined)
    if (!target) {
      toast.error("ไม่พบสินค้าที่ตรงกับคำค้น — เลือกจากรายการด้านล่างแทน")
      return
    }

    addToCart(target.id)
    setSearch("")
    searchRef.current?.focus()
  }

  function resetSale() {
    setCart([])
    setDiscountText("")
    setNote("")
    setReceivedText("")
    setPaymentMethod("CASH")
    setQr(null)
    setQrError(null)
    setFieldErrors({})
    setReceipt(null)
    searchRef.current?.focus()
  }

  async function handleCheckout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setFieldErrors({})

    const formData = new FormData()
    formData.set("items", JSON.stringify(cart))
    formData.set("discount", String(validDiscount ? discount : 0))
    formData.set("paymentMethod", paymentMethod)
    formData.set("amountReceived", paymentMethod === "CASH" ? String(received) : String(total))
    formData.set("note", note)

    try {
      const result = await createSale(formData)

      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {})
        toast.error(result.error)
        return
      }

      toast.success(result.message)
      setCheckoutOpen(false)
      if (result.data) setReceipt(result.data)
      setCart([])
      setDiscountText("")
      setNote("")
      setReceivedText("")
      router.refresh()
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  if (receipt) {
    return (
      <>
        <div className="page-head no-print">
          <div>
            <p className="t-eyebrow">ขายหน้าร้าน</p>
            <h1 className="t-h1">ขายสำเร็จ</h1>
          </div>
          <div className="row">
            <button type="button" className="btn btn-subtle" onClick={() => window.print()}>
              พิมพ์ใบเสร็จ
            </button>
            <button type="button" className="btn btn-primary" onClick={resetSale}>
              <IconPlus size={17} aria-hidden /> เริ่มบิลใหม่
            </button>
          </div>
        </div>

        <section className="card-ui card-pad" style={{ maxWidth: 420, margin: "0 auto", width: "100%" }}>
          <Receipt data={receipt} />
        </section>
      </>
    )
  }

  return (
    <>
      <div className="page-head no-print">
        <div>
          <p className="t-eyebrow">ขายหน้าร้าน</p>
          <h1 className="t-h1">POS</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            พิมพ์ชื่อหรือ SKU แล้วกด Enter เพื่อเพิ่มลงตะกร้า (ใช้กับเครื่องอ่านบาร์โค้ดได้ทันที)
          </p>
        </div>
      </div>

      <div className="pos-layout">
        <section className="card-ui">
          <div className="panel-head" style={{ flexWrap: "wrap", gap: 10 }}>
            <form className="row" style={{ gap: 10 }} onSubmit={handleSearchSubmit}>
              <div style={{ position: "relative" }}>
                <IconSearch
                  size={16}
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 11,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--ink-3)",
                  }}
                />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="input"
                  placeholder="ค้นหาชื่อสินค้าหรือ SKU"
                  style={{ paddingLeft: 34, width: 280 }}
                  autoFocus
                />
              </div>
              <button type="submit" className="btn btn-subtle">
                เพิ่ม
              </button>
            </form>

            <select
              className="select"
              style={{ width: 180 }}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="all">ทุกหมวดหมู่</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
              gap: 12,
              padding: 20,
            }}
          >
            {visibleProducts.length === 0 ? (
              <p className="t-body">ไม่พบสินค้าตามเงื่อนไขที่เลือก</p>
            ) : (
              visibleProducts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addToCart(p.id)}
                  disabled={p.quantity <= 0}
                  className="card-ui"
                  style={{
                    padding: 12,
                    textAlign: "left",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    cursor: p.quantity <= 0 ? "not-allowed" : "pointer",
                    opacity: p.quantity <= 0 ? 0.5 : 1,
                  }}
                >
                  <span style={{ fontWeight: 500, lineHeight: 1.35 }}>{p.name}</span>
                  <span className="t-caption num">{p.sku}</span>
                  <span className="row" style={{ justifyContent: "space-between", marginTop: "auto" }}>
                    <span className="num" style={{ fontWeight: 600 }}>
                      ฿{formatBaht(p.price)}
                    </span>
                    <span className={`chip ${p.quantity <= 0 ? "chip-danger" : "chip-neutral"}`}>
                      {p.quantity <= 0 ? "หมด" : `เหลือ ${formatNumber(p.quantity)}`}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="card-ui" style={{ position: "sticky", top: 20 }}>
          <div className="panel-head">
            <h2 className="t-h2">ตะกร้า</h2>
            {lines.length > 0 ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCart([])}>
                ล้างตะกร้า
              </button>
            ) : null}
          </div>

          {lines.length === 0 ? (
            <p className="t-body" style={{ padding: 24 }}>
              ยังไม่มีสินค้าในตะกร้า
            </p>
          ) : (
            <ul style={{ display: "flex", flexDirection: "column" }}>
              {lines.map((line) => (
                <li
                  key={line.productId}
                  style={{ padding: "12px 20px", borderTop: "1px solid var(--line)", display: "grid", gap: 8 }}
                >
                  <span className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontWeight: 500 }}>{line.product.name}</span>
                    <span className="num" style={{ fontWeight: 600 }}>
                      ฿{formatBaht(line.subtotal)}
                    </span>
                  </span>
                  <span className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <span className="row" style={{ gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm btn-icon"
                        aria-label={`ลดจำนวน ${line.product.name}`}
                        onClick={() => setQuantity(line.productId, line.quantity - 1)}
                      >
                        −
                      </button>
                      <input
                        className="input num"
                        style={{ width: 68, textAlign: "center" }}
                        value={line.quantity}
                        inputMode="numeric"
                        aria-label={`จำนวน ${line.product.name}`}
                        onChange={(e) => {
                          const next = Number(e.target.value.replace(/[^0-9]/g, ""))
                          setQuantity(line.productId, Number.isFinite(next) ? next : 0)
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm btn-icon"
                        aria-label={`เพิ่มจำนวน ${line.product.name}`}
                        onClick={() => setQuantity(line.productId, line.quantity + 1)}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm btn-icon"
                        aria-label={`ลบ ${line.product.name} ออกจากตะกร้า`}
                        onClick={() => setQuantity(line.productId, 0)}
                      >
                        <IconTrash size={15} aria-hidden />
                      </button>
                    </span>
                    <span className="t-caption num">
                      ฿{formatBaht(line.product.price)}/{line.product.unit}
                    </span>
                  </span>
                  {line.overStock ? (
                    <span className="field-hint error">
                      สต็อกเหลือ {formatNumber(line.product.quantity)} {line.product.unit} — ลดจำนวนก่อนชำระเงิน
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <div style={{ padding: 20, borderTop: "1px solid var(--line)", display: "grid", gap: 12 }}>
            <div className="field">
              <label className="t-small" htmlFor="discount">
                ส่วนลดท้ายบิล (บาท)
              </label>
              <input
                id="discount"
                className="input num"
                inputMode="decimal"
                value={discountText}
                onChange={(e) => setDiscountText(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
              />
              {!validDiscount ? (
                <span className="field-hint error">ส่วนลดต้องไม่ติดลบและไม่เกินยอดรวม</span>
              ) : null}
            </div>

            <div className="field">
              <label className="t-small" htmlFor="note">
                หมายเหตุ
              </label>
              <input
                id="note"
                className="input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="ไม่บังคับ"
              />
            </div>

            <div className="t-small" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="row" style={{ justifyContent: "space-between" }}>
                <span>ยอดรวม</span>
                <span className="num">฿{formatBaht(subtotal)}</span>
              </span>
              <span className="row" style={{ justifyContent: "space-between" }}>
                <span>ส่วนลด</span>
                <span className="num">−฿{formatBaht(validDiscount ? discount : 0)}</span>
              </span>
              <span
                className="row"
                style={{ justifyContent: "space-between", fontWeight: 700, fontSize: "1.05rem" }}
              >
                <span>ยอดสุทธิ</span>
                <span className="num">฿{formatBaht(total)}</span>
              </span>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-block btn-lg"
              disabled={lines.length === 0 || !validDiscount || hasOverStock || !allowed.includes("ADD")}
              title={!allowed.includes("ADD") ? "คุณไม่มีสิทธิ์ทำการขาย" : undefined}
              onClick={() => {
                setFieldErrors({})
                setReceivedText("")
                setCheckoutOpen(true)
              }}
            >
              <IconWallet size={18} aria-hidden /> ชำระเงิน
            </button>
            {!allowed.includes("ADD") ? <span className="field-hint">คุณมีสิทธิ์ดูอย่างเดียว — ทำการขายไม่ได้</span> : null}
            {hasOverStock ? (
              <span className="field-hint error">มีรายการที่เกินสต็อกคงเหลือ — แก้ไขก่อนชำระเงิน</span>
            ) : null}
          </div>
        </section>
      </div>

      <Dialog open={checkoutOpen} onOpenChange={(open) => !open && setCheckoutOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ชำระเงิน</DialogTitle>
            <DialogDescription>
              ยอดสุทธิ ฿{formatBaht(total)} — {lines.length} รายการ
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCheckout} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="field">
              <span className="t-small">วิธีชำระเงิน</span>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {PAYMENT_METHODS.map((method) => (
                  <button
                    key={method}
                    type="button"
                    className={method === paymentMethod ? "btn btn-primary btn-sm" : "btn btn-subtle btn-sm"}
                    onClick={() => {
                      setPaymentMethod(method)
                      if (method === "QR") void loadQr(total)
                    }}
                  >
                    {PAYMENT_METHOD_LABEL[method]}
                  </button>
                ))}
              </div>
            </div>

            {paymentMethod === "CASH" ? (
              <>
                <div className="field">
                  <label className="t-small" htmlFor="amountReceived">
                    รับเงินมา (บาท) <span style={{ color: "var(--danger)" }}>*</span>
                  </label>
                  <input
                    id="amountReceived"
                    className="input num"
                    inputMode="decimal"
                    autoFocus
                    value={receivedText}
                    onChange={(e) => setReceivedText(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder={total.toFixed(2)}
                  />
                  {fieldErrors.amountReceived ? (
                    <span className="field-hint error">{fieldErrors.amountReceived}</span>
                  ) : null}
                </div>

                <div
                  className="row"
                  style={{
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: "var(--surface-2)",
                  }}
                >
                  <span className="t-small">เงินทอน</span>
                  <span
                    className="num"
                    style={{ fontWeight: 700, color: changeDue < 0 ? "var(--danger)" : undefined }}
                  >
                    ฿{formatBaht(Math.max(changeDue, 0))}
                  </span>
                </div>
              </>
            ) : paymentMethod === "QR" ? (
              <div className="field" style={{ alignItems: "center", textAlign: "center" }}>
                {qr ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- data URL ที่สร้างสด */}
                    <img src={qr.dataUrl} alt="QR พร้อมเพย์สำหรับชำระเงิน" width={220} height={220} style={{ borderRadius: 12, border: "1px solid var(--line)" }} />
                    <span className="t-body">ให้ลูกค้าสแกนจ่าย <strong className="num">฿{formatBaht(qr.amount)}</strong></span>
                    <span className="t-caption num">พร้อมเพย์ร้าน {qr.maskedId} · เห็นเงินเข้าแล้วค่อยกดยืนยัน</span>
                  </>
                ) : qrError ? (
                  <div className="alert-banner warning">{qrError}</div>
                ) : (
                  <span className="t-caption">
                    <IconSpinner size={16} className="animate-spin" aria-hidden /> กำลังสร้าง QR…
                  </span>
                )}
              </div>
            ) : (
              <p className="t-small">
                รับเงินเท่ายอดสุทธิ ฿{formatBaht(total)} — ไม่มีเงินทอนสำหรับการชำระแบบ
                {PAYMENT_METHOD_LABEL[paymentMethod]}
              </p>
            )}

            <DialogFooter>
              <button type="button" className="btn btn-ghost" onClick={() => setCheckoutOpen(false)}>
                ยกเลิก
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={pending || (paymentMethod === "CASH" && received < total)}
              >
                {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
                ยืนยันการชำระเงิน
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
