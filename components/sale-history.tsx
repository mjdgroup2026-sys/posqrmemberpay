"use client"

import { FULL_ACCESS, type AllowedActions } from "@/lib/types"
import { useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { voidSale } from "@/app/actions/sales"
import { formatBaht, formatDateTime, formatNumber } from "@/lib/format"
import type { SaleListItem } from "@/lib/queries"
import { PAYMENT_METHOD_LABEL } from "@/lib/types"
import { IconSearch, IconSpinner } from "@/components/icons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Props = {
  /// สิทธิ์บน POS_HISTORY — DELETE = กด void ได้
  allowed?: AllowedActions
  sales: SaleListItem[]
  from: string
  to: string
  status: string
  search: string
}

export function SaleHistory({ sales, from, to, status, search, allowed = FULL_ACCESS }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isNavigating, startNavigation] = useTransition()

  const [detail, setDetail] = useState<SaleListItem | null>(null)
  const [voiding, setVoiding] = useState<SaleListItem | null>(null)
  const [reason, setReason] = useState("")
  const [pending, setPending] = useState(false)

  function updateQuery(patch: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value && value !== "all") params.set(key, value)
      else params.delete(key)
    }
    startNavigation(() => router.push(`/pos/history?${params.toString()}`))
  }

  async function handleVoid(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!voiding) return
    setPending(true)

    const formData = new FormData()
    formData.set("id", voiding.id)
    formData.set("reason", reason)

    try {
      const result = await voidSale(formData)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      setVoiding(null)
      setReason("")
      router.refresh()
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  const completedTotal = sales
    .filter((s) => s.status === "COMPLETED")
    .reduce((sum, s) => sum + s.total, 0)

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">ขายหน้าร้าน</p>
          <h1 className="t-h1">ประวัติการขาย</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            ยกเลิกบิลได้เฉพาะบิลของวันนี้ที่ยังไม่ถูกยกเลิกและยังไม่ได้ปิดยอดประจำวัน
          </p>
        </div>
        <span className="chip chip-brand">
          <span className="dot" />
          ยอดขายที่แสดง ฿<span className="num">{formatBaht(completedTotal)}</span>
        </span>
      </div>

      <section className="card-ui">
        <div className="panel-head" style={{ flexWrap: "wrap", gap: 10 }}>
          <form
            className="row"
            style={{ gap: 10 }}
            onSubmit={(e) => {
              e.preventDefault()
              updateQuery({ q: String(new FormData(e.currentTarget).get("q") ?? "") })
            }}
          >
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
                name="q"
                defaultValue={search}
                className="input num"
                placeholder="ค้นหาเลขที่บิล"
                style={{ paddingLeft: 34, width: 220 }}
              />
            </div>
            <button type="submit" className="btn btn-subtle">
              ค้นหา
            </button>
          </form>

          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <input
              type="date"
              className="input num"
              style={{ width: 165 }}
              value={from}
              aria-label="ตั้งแต่วันที่"
              onChange={(e) => updateQuery({ from: e.target.value })}
            />
            <span className="t-caption">ถึง</span>
            <input
              type="date"
              className="input num"
              style={{ width: 165 }}
              value={to}
              aria-label="ถึงวันที่"
              onChange={(e) => updateQuery({ to: e.target.value })}
            />
            <select
              className="select"
              style={{ width: 150 }}
              value={status || "all"}
              onChange={(e) => updateQuery({ status: e.target.value })}
            >
              <option value="all">ทุกสถานะ</option>
              <option value="COMPLETED">สำเร็จ</option>
              <option value="VOIDED">ยกเลิกแล้ว</option>
            </select>
          </div>
        </div>

        <div className="datatable-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                <th style={{ padding: "10px 24px", fontWeight: 500 }}>เลขที่บิล</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>เวลา</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>พนักงานขาย</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>รายการ</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>ชำระโดย</th>
                <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ยอดสุทธิ</th>
                <th style={{ padding: "10px 12px", fontWeight: 500 }}>สถานะ</th>
                <th style={{ padding: "10px 24px", fontWeight: 500, textAlign: "right" }}>จัดการ</th>
              </tr>
            </thead>
            <tbody style={{ opacity: isNavigating ? 0.55 : 1, transition: "opacity .15s" }}>
              {sales.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 28, textAlign: "center" }} className="t-body">
                    ไม่พบบิลตามเงื่อนไขที่เลือก
                  </td>
                </tr>
              ) : (
                sales.map((sale) => (
                  <tr key={sale.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td className="num" style={{ padding: "12px 24px", fontWeight: 600 }}>
                      {sale.saleNumber}
                    </td>
                    <td className="t-caption num" style={{ padding: "12px" }}>
                      {formatDateTime(sale.createdAt)}
                    </td>
                    <td style={{ padding: "12px" }}>{sale.cashierName}</td>
                    <td className="num" style={{ padding: "12px", textAlign: "right" }}>
                      {formatNumber(sale.items.length)}
                    </td>
                    <td style={{ padding: "12px" }}>
                      {PAYMENT_METHOD_LABEL[sale.paymentMethod]}
                      {sale.channel !== "RETAIL_POS" ? (
                        <>
                          <br />
                          <span className="t-caption">
                            {sale.channel === "TAKEAWAY"
                              ? "อาหารกลับบ้าน"
                              : `Mobile Order${sale.tableCode ? ` · โต๊ะ ${sale.tableCode}` : ""}`}
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td className="num" style={{ padding: "12px", textAlign: "right", fontWeight: 600 }}>
                      ฿{formatBaht(sale.total)}
                    </td>
                    <td style={{ padding: "12px" }}>
                      <span className={`chip ${sale.status === "COMPLETED" ? "chip-success" : "chip-danger"}`}>
                        <span className="dot" />
                        {sale.status === "COMPLETED" ? "สำเร็จ" : "ยกเลิกแล้ว"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 24px", textAlign: "right" }}>
                      <span className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDetail(sale)}>
                          รายละเอียด
                        </button>
                        {sale.canVoid && allowed.includes("DELETE") ? (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => {
                              setReason("")
                              setVoiding(sale)
                            }}
                          >
                            ยกเลิกบิล
                          </button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>บิล {detail?.saleNumber}</DialogTitle>
            <DialogDescription>
              {detail ? `${formatDateTime(detail.createdAt)} · ${detail.cashierName}` : null}
            </DialogDescription>
          </DialogHeader>

          {detail ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {detail.status === "VOIDED" ? (
                <div className="alert-banner danger">
                  ยกเลิกเมื่อ {detail.voidedAt ? formatDateTime(detail.voidedAt) : "—"}
                  {detail.voidedByName ? ` โดย ${detail.voidedByName}` : ""}
                  {detail.voidReason ? ` · เหตุผล: ${detail.voidReason}` : ""}
                </div>
              ) : null}

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--ink-3)" }}>
                    <th style={{ padding: "6px 0", fontWeight: 500 }}>รายการ</th>
                    <th style={{ padding: "6px 0", fontWeight: 500, textAlign: "right" }}>จำนวน</th>
                    <th style={{ padding: "6px 0", fontWeight: 500, textAlign: "right" }}>รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item) => (
                    <tr key={item.id} style={{ borderTop: "1px solid var(--line)" }}>
                      <td style={{ padding: "8px 0" }}>
                        {item.name} <span className="t-caption num">({item.sku})</span>
                      </td>
                      <td className="num" style={{ padding: "8px 0", textAlign: "right" }}>
                        {formatNumber(item.quantity)} {item.unit}
                      </td>
                      <td className="num" style={{ padding: "8px 0", textAlign: "right" }}>
                        ฿{formatBaht(item.subtotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="t-small" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="row" style={{ justifyContent: "space-between" }}>
                  <span>ยอดรวม</span>
                  <span className="num">฿{formatBaht(detail.subtotal)}</span>
                </span>
                <span className="row" style={{ justifyContent: "space-between" }}>
                  <span>ส่วนลด</span>
                  <span className="num">−฿{formatBaht(detail.discount)}</span>
                </span>
                <span className="row" style={{ justifyContent: "space-between", fontWeight: 700 }}>
                  <span>ยอดสุทธิ</span>
                  <span className="num">฿{formatBaht(detail.total)}</span>
                </span>
                <span className="row" style={{ justifyContent: "space-between" }}>
                  <span>ชำระโดย</span>
                  <span>
                    {PAYMENT_METHOD_LABEL[detail.paymentMethod]}
                    {detail.channel === "TAKEAWAY"
                      ? " · อาหารกลับบ้าน"
                      : detail.channel === "MOBILE_ORDER"
                        ? ` · Mobile Order${detail.tableCode ? ` โต๊ะ ${detail.tableCode}` : ""}`
                        : ""}
                  </span>
                </span>
                {detail.paymentMethod === "CASH" ? (
                  <span className="row" style={{ justifyContent: "space-between" }}>
                    <span>รับเงิน / ทอน</span>
                    <span className="num">
                      ฿{formatBaht(detail.amountReceived)} / ฿{formatBaht(detail.changeDue)}
                    </span>
                  </span>
                ) : null}
                {detail.note ? (
                  <span className="row" style={{ justifyContent: "space-between" }}>
                    <span>หมายเหตุ</span>
                    <span>{detail.note}</span>
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <button type="button" className="btn btn-ghost" onClick={() => setDetail(null)}>
              ปิด
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={voiding !== null} onOpenChange={(open) => !open && setVoiding(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ยกเลิกบิล {voiding?.saleNumber}</DialogTitle>
            <DialogDescription>
              ระบบจะคืนสต็อกให้อัตโนมัติด้วยรายการชดเชย และบิลนี้จะไม่ถูกนับในยอดขายอีก
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleVoid} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="field">
              <label className="t-small" htmlFor="reason">
                เหตุผลที่ยกเลิก <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                id="reason"
                className="input"
                required
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="เช่น ลูกค้าเปลี่ยนใจ / คีย์ผิด"
              />
            </div>

            <DialogFooter>
              <button type="button" className="btn btn-ghost" onClick={() => setVoiding(null)}>
                ไม่ยกเลิก
              </button>
              <button type="submit" className="btn btn-danger-solid" disabled={pending}>
                {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
                ยืนยันยกเลิกบิล
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
