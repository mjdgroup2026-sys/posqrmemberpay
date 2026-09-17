"use client"

import { FULL_ACCESS, type AllowedActions } from "@/lib/types"
import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { cancelOrderItem, markItemServed, reduceOrderItemQuantity, reprintKitchenTicket } from "@/app/actions/orders"
import { cancelTableSession } from "@/app/actions/tables"
import { acknowledgeNotification } from "@/app/actions/notifications"
import { formatBaht, formatClock, formatDateTime, formatNumber } from "@/lib/format"
import type { OrderItemRow, TableDetail as TableDetailData } from "@/lib/queries"
import { LiveElapsed } from "@/components/live-elapsed"
import { AutoRefresh } from "@/components/auto-refresh"
import { IconBack, IconPlus, IconReceipt, IconSpinner } from "@/components/icons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const ITEM_STATUS: Record<OrderItemRow["status"], { label: string; chip: string }> = {
  AWAITING_KITCHEN: { label: "รอครัวรับ", chip: "chip-danger" },
  COOKING: { label: "กำลังปรุง", chip: "chip-warning" },
  READY: { label: "พร้อมเสิร์ฟ", chip: "chip-success" },
  SERVED: { label: "เสิร์ฟแล้ว", chip: "chip-neutral" },
  CANCELLED: { label: "ยกเลิกแล้ว", chip: "chip-neutral" },
}

export function TableDetail({
  detail,
  allowed = FULL_ACCESS,
  canAcknowledge = true,
  canKitchen = true,
  canOrderMore = true,
}: {
  detail: TableDetailData
  /// สิทธิ์บน MO_TABLES: EDIT ปิดบิล/กดเสิร์ฟ/พิมพ์ทิกเก็ต · DELETE ยกเลิกโต๊ะ/รายการ
  allowed?: AllowedActions
  /// MO_NOTIFICATIONS:EDIT
  canAcknowledge?: boolean
  /// MO_KITCHEN:EDIT — กดเสิร์ฟ/พิมพ์ทิกเก็ตได้อีกทาง (action รับได้ทั้งสองสิทธิ์)
  canKitchen?: boolean
  /// MO_POS:ADD — ปุ่ม "สั่งเพิ่ม" พาไปจอขายโดยเลือกโต๊ะนี้ให้ (F13: เพิ่มจำนวน = รอบใหม่ ทิกเก็ตใหม่)
  canOrderMore?: boolean
}) {
  const canServe = allowed.includes("EDIT") || canKitchen
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [cancellingItem, setCancellingItem] = useState<OrderItemRow | null>(null)
  const [itemReason, setItemReason] = useState("")
  // ลดจำนวน (F13) — ได้เฉพาะรายการที่ครัวยังไม่รับ · เพิ่มจำนวน = ปุ่ม "สั่งเพิ่ม" ไปจอขายเป็นรอบใหม่
  const [reducingItem, setReducingItem] = useState<OrderItemRow | null>(null)
  const [reduceTo, setReduceTo] = useState(1)
  const [cancellingTable, setCancellingTable] = useState(false)
  const [tableReason, setTableReason] = useState("")

  async function run(action: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setPending(true)
    try {
      const result = await action()
      if (!result.ok) {
        toast.error(result.error ?? "ทำรายการไม่สำเร็จ")
        router.refresh()
        return false
      }
      toast.success(result.message ?? "ทำรายการเรียบร้อยแล้ว")
      router.refresh()
      return true
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
      return false
    } finally {
      setPending(false)
    }
  }

  function serveItem(item: OrderItemRow) {
    const formData = new FormData()
    formData.set("id", item.id)
    void run(() => markItemServed(formData))
  }

  function reprint(orderId: string) {
    const formData = new FormData()
    formData.set("id", orderId)
    void run(() => reprintKitchenTicket(formData))
  }

  function acknowledge(id: string) {
    const formData = new FormData()
    formData.set("id", id)
    void run(() => acknowledgeNotification(formData))
  }

  async function submitItemCancel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!cancellingItem) return
    const formData = new FormData()
    formData.set("id", cancellingItem.id)
    formData.set("reason", itemReason)
    const done = await run(() => cancelOrderItem(formData))
    if (done) {
      setCancellingItem(null)
      setItemReason("")
    }
  }

  async function submitItemReduce(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reducingItem) return
    const formData = new FormData()
    formData.set("id", reducingItem.id)
    formData.set("quantity", String(reduceTo))
    const done = await run(() => reduceOrderItemQuantity(formData))
    if (done) setReducingItem(null)
  }

  async function submitTableCancel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData()
    formData.set("sessionId", detail.sessionId)
    formData.set("reason", tableReason)
    const done = await run(() => cancelTableSession(formData))
    if (done) {
      setCancellingTable(false)
      router.push("/mobile-order/tables")
    }
  }

  return (
    <>
      <AutoRefresh seconds={15} />

      <div className="page-head">
        <div>
          <p className="t-eyebrow">
            <Link href="/mobile-order/tables" className="row" style={{ gap: 6 }}>
              <IconBack size={14} aria-hidden /> กลับไปผังโต๊ะ
            </Link>
          </p>
          <h1 className="t-h1">โต๊ะ {detail.tableCode}</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            เปิดโต๊ะ <span className="num">{formatClock(detail.openedAt)}</span> ·{" "}
            <LiveElapsed since={detail.openedAt} prefix="เปิดมาแล้ว " />
            {detail.qrType ? ` · QR ${detail.qrType === "STATIC" ? "ถาวร" : "ชั่วคราว"}` : ""}
            {detail.mergedTableCodes.length > 0
              ? ` · รวมโต๊ะ ${detail.mergedTableCodes.map((c) => `โต๊ะ ${c}`).join(", ")}`
              : ""}
          </p>
        </div>
        <div className="row">
          <span className="chip chip-brand">
            <span className="dot" />
            ยอดรวม ฿<span className="num">{formatBaht(detail.total)}</span>
          </span>
          {canOrderMore && detail.status !== "AWAITING_BILL" ? (
            <Link href={`/mobile-order/pos?table=${detail.tableId}`} className="btn btn-subtle">
              <IconPlus size={17} aria-hidden />
              สั่งเพิ่ม
            </Link>
          ) : null}
          {allowed.includes("EDIT") ? (
            <Link href={`/mobile-order/tables/${detail.tableId}/billing`} className="btn btn-primary">
              <IconReceipt size={17} aria-hidden />
              ปิดบิล / รับชำระเงิน
            </Link>
          ) : null}
          {allowed.includes("DELETE") ? (
            <button
              type="button"
              className="btn btn-danger"
              disabled={pending}
              onClick={() => {
                setTableReason("")
                setCancellingTable(true)
              }}
            >
              ยกเลิกโต๊ะ
            </button>
          ) : null}
        </div>
      </div>

      {detail.notifications.length > 0 ? (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {detail.notifications.map((n) => (
            <div key={n.id} className="alert-banner danger" style={{ justifyContent: "space-between" }}>
              <span>
                {n.type === "CALL_STAFF" ? "ลูกค้าเรียกพนักงาน" : "ลูกค้าขอเช็กบิล"}
                {n.reason ? ` · ${n.reason}` : ""} · {formatDateTime(n.createdAt)}
              </span>
              {canAcknowledge ? (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={pending}
                  onClick={() => acknowledge(n.id)}
                >
                  รับทราบ
                </button>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {detail.orders.length === 0 ? (
        <section className="card-ui card-pad">
          <p className="t-body">โต๊ะนี้ยังไม่มีออร์เดอร์</p>
        </section>
      ) : (
        detail.orders.map((order) => (
          <section key={order.id} className="card-ui">
            <div className="panel-head">
              <div>
                <h2 className="t-h2">ออร์เดอร์ที่ {order.orderNumber}</h2>
                <span className="t-caption num">
                  ส่งเข้าครัว {formatDateTime(order.submittedAt)}
                  {order.printedAt ? ` · พิมพ์ทิกเก็ตแล้ว ${formatClock(order.printedAt)}` : " · ยังไม่ได้พิมพ์ทิกเก็ต"}
                </span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {/* เส้นทางหลักตอนนี้คือ PDF — ปุ่มส่งเข้าเครื่องพิมพ์จริงยังอยู่ เผื่อร้านต่อเครื่องแล้ว */}
                <a
                  href={`/tickets/${order.id}?auto=1`}
                  target="_blank"
                  rel="noopener"
                  className="btn btn-primary btn-sm"
                >
                  <IconReceipt size={15} aria-hidden />
                  ทิกเก็ต PDF
                </a>
                {canServe ? (
                  <button
                    type="button"
                    className="btn btn-subtle btn-sm"
                    disabled={pending}
                    onClick={() => reprint(order.id)}
                    title="ส่งเข้าเครื่องพิมพ์ครัวที่ต่อ LAN (ต้องตั้ง KITCHEN_PRINTER_HOST)"
                  >
                    ส่งเข้าเครื่องพิมพ์
                  </button>
                ) : null}
              </div>
            </div>

            <ul style={{ display: "flex", flexDirection: "column" }}>
              {order.items.map((item) => (
                <li
                  key={item.id}
                  style={{
                    padding: "12px 24px",
                    borderTop: "1px solid var(--line)",
                    display: "grid",
                    gap: 6,
                    opacity: item.status === "CANCELLED" ? 0.55 : 1,
                  }}
                >
                  <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
                    <span>
                      <span className="num" style={{ fontWeight: 700 }}>
                        {formatNumber(item.quantity)}×
                      </span>{" "}
                      <span style={{ fontWeight: 500 }}>{item.menuItemName}</span>
                      {item.options.length > 0 ? (
                        <span className="t-caption"> ({item.options.map((o) => o.optionName).join(", ")})</span>
                      ) : null}
                    </span>
                    <span className="row" style={{ gap: 10 }}>
                      <span className={`chip ${ITEM_STATUS[item.status].chip}`}>
                        <span className="dot" />
                        {ITEM_STATUS[item.status].label}
                      </span>
                      <span className="num" style={{ fontWeight: 600 }}>
                        ฿{formatBaht(item.subtotal)}
                      </span>
                    </span>
                  </div>

                  {item.note ? <span className="t-caption">โน้ตถึงครัว: {item.note}</span> : null}
                  {item.cancelReason ? (
                    <span className="t-caption">เหตุผลที่ยกเลิก: {item.cancelReason}</span>
                  ) : null}

                  <div className="row" style={{ gap: 6 }}>
                    {/* ปุ่มยกเลิกโผล่เฉพาะตอนยังรอครัวรับ — server ก็ปฏิเสธซ้ำอีกชั้นด้วย conditional update */}
                    {item.status === "AWAITING_KITCHEN" && allowed.includes("DELETE") ? (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={pending}
                        onClick={() => {
                          setItemReason("")
                          setCancellingItem(item)
                        }}
                      >
                        ยกเลิกรายการ
                      </button>
                    ) : null}

                    {/* ลดจำนวน (F13) — เฉพาะรายการที่ครัวยังไม่รับและมีมากกว่า 1 · สิทธิ์เดียวกับยกเลิกรายการ */}
                    {item.status === "AWAITING_KITCHEN" && item.quantity > 1 && allowed.includes("DELETE") ? (
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm"
                        disabled={pending}
                        onClick={() => {
                          setReduceTo(item.quantity - 1)
                          setReducingItem(item)
                        }}
                      >
                        ลดจำนวน
                      </button>
                    ) : null}

                    {/* ร้านที่ไม่มี KDS ข้ามจากรอครัวรับไป "เสิร์ฟแล้ว" ได้เลย */}
                    {canServe && (item.status === "READY" || (!detail.hasKDS && item.status === "AWAITING_KITCHEN")) ? (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={pending}
                        onClick={() => serveItem(item)}
                      >
                        เสิร์ฟอาหารแล้ว
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <Dialog open={cancellingItem !== null} onOpenChange={(open) => !open && setCancellingItem(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ยกเลิก {cancellingItem?.menuItemName}</DialogTitle>
            <DialogDescription>
              ยกเลิกได้เฉพาะรายการที่ครัวยังไม่เริ่มทำ — ถ้าครัวกดเริ่มปรุงไปแล้วระบบจะปฏิเสธ
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submitItemCancel} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="field">
              <label className="t-small" htmlFor="itemReason">
                เหตุผล <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                id="itemReason"
                className="input"
                required
                autoFocus
                value={itemReason}
                onChange={(e) => setItemReason(e.target.value)}
                placeholder="เช่น ลูกค้าเปลี่ยนใจ / กดผิด"
              />
            </div>

            <DialogFooter>
              <button type="button" className="btn btn-ghost" onClick={() => setCancellingItem(null)}>
                ไม่ยกเลิก
              </button>
              <button type="submit" className="btn btn-danger-solid" disabled={pending}>
                {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
                ยืนยันยกเลิกรายการ
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={reducingItem !== null} onOpenChange={(open) => !open && setReducingItem(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ลดจำนวน {reducingItem?.menuItemName}</DialogTitle>
            <DialogDescription>
              ลดได้เฉพาะรายการที่ครัวยังไม่รับ — ระบบจะบันทึกว่าใครลดจากเท่าไรเป็นเท่าไร · ถ้าต้องการเพิ่ม
              ให้กด &ldquo;สั่งเพิ่ม&rdquo; เป็นรอบใหม่แทน
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submitItemReduce} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="field">
              <label className="t-small" htmlFor="reduceTo">
                จำนวนใหม่ (เดิม {reducingItem?.quantity ?? 0})
              </label>
              <input
                id="reduceTo"
                className="input num"
                type="number"
                inputMode="numeric"
                min={1}
                max={(reducingItem?.quantity ?? 2) - 1}
                required
                autoFocus
                value={reduceTo}
                onChange={(e) => setReduceTo(Math.max(1, Number(e.target.value) || 1))}
              />
              <span className="field-hint">ลดเหลือ 0 = ใช้ปุ่ม &ldquo;ยกเลิกรายการ&rdquo; แทน (ต้องระบุเหตุผล)</span>
            </div>

            <DialogFooter>
              <button type="button" className="btn btn-ghost" onClick={() => setReducingItem(null)}>
                ยกเลิก
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={pending || !reducingItem || reduceTo >= reducingItem.quantity}
              >
                {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
                ยืนยันลดเหลือ {reduceTo}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={cancellingTable} onOpenChange={(open) => !open && setCancellingTable(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ยกเลิกโต๊ะ {detail.tableCode}</DialogTitle>
            <DialogDescription>
              รายการที่ยังไม่เสิร์ฟจะถูกยกเลิกทั้งหมด และไม่มีการออกบิลเพราะยังไม่ได้ชำระเงิน
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submitTableCancel} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="field">
              <label className="t-small" htmlFor="tableReason">
                เหตุผล <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                id="tableReason"
                className="input"
                required
                autoFocus
                value={tableReason}
                onChange={(e) => setTableReason(e.target.value)}
                placeholder="เช่น ลูกค้าไม่มาแล้ว"
              />
            </div>

            <DialogFooter>
              <button type="button" className="btn btn-ghost" onClick={() => setCancellingTable(false)}>
                ไม่ยกเลิก
              </button>
              <button type="submit" className="btn btn-danger-solid" disabled={pending}>
                {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
                ยืนยันยกเลิกโต๊ะ
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
