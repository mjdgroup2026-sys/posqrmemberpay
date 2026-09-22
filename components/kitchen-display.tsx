"use client"

import { useCallback, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import {
  cancelOrderItem,
  markItemReady,
  markItemServed,
  markOrderReady,
  markOrderServed,
  startCookingItem,
  startCookingOrder,
} from "@/app/actions/orders"
import { formatClock, formatNumber } from "@/lib/format"
import type { KitchenStationRow, KitchenTicket, OrderItemRow } from "@/lib/queries"
import { UNASSIGNED_STATION_LABEL } from "@/lib/ticket-lines"
import type { ActionResult } from "@/lib/types"
import { LiveElapsed } from "@/components/live-elapsed"
import { AutoRefresh } from "@/components/auto-refresh"
import { AutoPrint } from "@/components/auto-print"
import { useKitchenAlert } from "@/components/kitchen-alert"
import { IconKitchen, IconReceipt, IconSoundOff, IconSoundOn, IconSpinner, IconStation } from "@/components/icons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type ColumnKey = "AWAITING_KITCHEN" | "COOKING" | "READY"
type ItemAction = (formData: FormData) => Promise<ActionResult>

type Column = {
  key: ColumnKey
  title: string
  chip: string
  /// ปุ่มต่อบรรทัด (Phase 19 — แยกรายการได้ ไม่ต้องเสร็จทั้งใบ)
  item: { label: string; className: string; run: ItemAction }
  /// ทางลัด "ทั้งใบ" ท้ายการ์ด — ใช้ action ระดับออร์เดอร์เดิม
  order: { label: string; className: string; run: ItemAction }
}

const COLUMNS: Column[] = [
  {
    key: "AWAITING_KITCHEN",
    title: "ออร์เดอร์ใหม่",
    chip: "chip-danger",
    item: { label: "เริ่ม", className: "btn btn-primary btn-sm", run: startCookingItem },
    order: { label: "เริ่มปรุงทั้งใบ", className: "btn btn-primary btn-sm btn-block", run: startCookingOrder },
  },
  {
    key: "COOKING",
    title: "กำลังปรุง",
    chip: "chip-warning",
    item: { label: "เสร็จ", className: "btn btn-accent btn-sm", run: markItemReady },
    order: { label: "ทำเสร็จทั้งใบ", className: "btn btn-accent btn-sm btn-block", run: markOrderReady },
  },
  {
    key: "READY",
    title: "พร้อมเสิร์ฟ",
    chip: "chip-success",
    item: { label: "เสิร์ฟ", className: "btn btn-subtle btn-sm", run: markItemServed },
    order: { label: "เสิร์ฟแล้วทั้งใบ", className: "btn btn-subtle btn-sm btn-block", run: markOrderServed },
  },
]

/// ค่าใน ?station= — id ของ station · "none" = เฉพาะที่ไม่ระบุครัว · ไม่มี = ทุกครัว
const STATION_NONE = "none"

/// กระดาน 3 คอลัมน์ของครัว — ใช้เฉพาะร้านที่เปิด `hasKDS` เท่านั้น
/// ร้านที่ปิดไว้ถูกกันตั้งแต่ที่หน้า (app/(staff)/(app)/mobile-order/kitchen/page.tsx)
/// จึงไม่ต้องมีสาขาโหมดไม่มี KDS ในนี้อีก
///
/// Phase 19: · ปุ่มต่อบรรทัด (เริ่ม/เสร็จ/เสิร์ฟ/ยกเลิก) ผ่าน action รายรายการที่มี conditional update อยู่แล้ว (กติกาข้อ 7)
///           · แท็บกรองตามประเภทครัว (`?station=`) ให้จอทอด/บาร์น้ำเปิดค้างคนละแท็บได้ · รายการที่ถูกยกเลิกขีดฆ่าบนการ์ด
///           · เตือนออร์เดอร์ใหม่ (toast + เสียง) และพิมพ์ทิกเก็ตอัตโนมัติผ่าน iframe ตามค่าตั้งของร้าน
export function KitchenDisplay({
  tickets,
  stations,
  canEdit = true,
  canCancel = false,
  alertSound = true,
  autoPrint = false,
}: {
  tickets: KitchenTicket[]
  stations: KitchenStationRow[]
  /// MO_KITCHEN:EDIT — เริ่มทำ/เสร็จ/เสิร์ฟ
  canEdit?: boolean
  /// MO_TABLES:DELETE — ยกเลิกรายการ (สิทธิ์เดียวกับปุ่มยกเลิกบนหน้าโต๊ะ)
  canCancel?: boolean
  /// StoreSettings.kitchenAlertSound / kitchenAutoPrint
  alertSound?: boolean
  autoPrint?: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const stationFilter = searchParams.get("station")
  const [pending, setPending] = useState(false)
  const [cancelling, setCancelling] = useState<{ item: OrderItemRow; label: string } | null>(null)
  const [reason, setReason] = useState("")

  // ── ตัวกรองประเภทครัว ──
  const filtered = useMemo(() => {
    if (!stationFilter) return tickets
    return tickets
      .map((t) => ({
        ...t,
        items: t.items.filter((i) =>
          stationFilter === STATION_NONE ? i.stationId === null : i.stationId === stationFilter,
        ),
      }))
      .filter((t) => t.items.some((i) => i.status !== "CANCELLED"))
  }, [tickets, stationFilter])

  const hasUnassigned = tickets.some((t) => t.items.some((i) => i.stationId === null))

  // ── เตือนออร์เดอร์ใหม่ + พิมพ์อัตโนมัติ (นับจากทิกเก็ตที่ยังมีของ "รอครัวรับ" ในมุมมองที่กรองแล้ว) ──
  const incomingIds = useMemo(
    () => filtered.filter((t) => t.items.some((i) => i.status === "AWAITING_KITCHEN")).map((t) => t.orderId),
    [filtered],
  )
  const labelOf = useCallback(
    (orderId: string) => {
      const t = tickets.find((x) => x.orderId === orderId)
      if (!t) return orderId
      return t.orderType === "TAKEAWAY" ? t.tableCode : `โต๊ะ ${t.tableCode}`
    },
    [tickets],
  )
  const { soundOn, toggleSound, newOrderIds } = useKitchenAlert(incomingIds, labelOf, { soundEnabledByStore: alertSound })
  const printQueue = useMemo(() => {
    if (!autoPrint || stationFilter) return []
    return newOrderIds.filter((id) => tickets.find((t) => t.orderId === id)?.printedAt === null)
  }, [autoPrint, stationFilter, newOrderIds, tickets])

  // ── เรียก action ──
  async function handle(action: ItemAction, formData: FormData): Promise<boolean> {
    setPending(true)
    try {
      const result = await action(formData)
      if (!result.ok) {
        toast.error(result.error ?? "เปลี่ยนสถานะไม่สำเร็จ")
        // สถานะอาจถูกเปลี่ยนจากอีกเครื่องไปแล้ว — ดึงข้อมูลใหม่ให้เห็นของจริงทันที
        router.refresh()
        return false
      }
      toast.success(result.message ?? "อัปเดตแล้ว")
      router.refresh()
      return true
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
      return false
    } finally {
      setPending(false)
    }
  }

  function runById(action: ItemAction, id: string) {
    const formData = new FormData()
    formData.set("id", id)
    void handle(action, formData)
  }

  async function submitCancel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!cancelling) return
    const formData = new FormData()
    formData.set("id", cancelling.item.id)
    formData.set("reason", reason)
    const ok = await handle(cancelOrderItem, formData)
    if (ok) {
      setCancelling(null)
      setReason("")
    }
  }

  function selectStation(value: string | null) {
    router.push(value ? `/mobile-order/kitchen?station=${value}` : "/mobile-order/kitchen")
  }

  function ticketsFor(status: ColumnKey) {
    // การ์ดหนึ่งใบต่อออร์เดอร์ต่อคอลัมน์ — พกรายการที่ถูกยกเลิกไปโชว์ในคอลัมน์ "ออร์เดอร์ใหม่" ให้ครัวเห็นว่าไม่ต้องทำ
    return filtered
      .map((ticket) => ({
        ...ticket,
        items: ticket.items.filter((i) => i.status === status),
        cancelled: status === "AWAITING_KITCHEN" ? ticket.items.filter((i) => i.status === "CANCELLED") : [],
      }))
      .filter((ticket) => ticket.items.length > 0)
  }

  function renderItem(item: OrderItemRow, column: Column, label: string) {
    return (
      <li key={item.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span>
            <span className="num" style={{ fontWeight: 700 }}>
              {formatNumber(item.quantity)}×
            </span>{" "}
            {item.menuItemName}
            {stations.length > 0 && !stationFilter ? (
              <span className="t-caption" style={{ marginLeft: 6, color: "var(--ink-3)" }}>
                · {item.stationName ?? UNASSIGNED_STATION_LABEL}
              </span>
            ) : null}
          </span>
          {item.options.length > 0 ? (
            <span className="t-caption" style={{ color: "var(--brand-strong)" }}>
              ({item.options.map((o) => o.optionName).join(", ")})
            </span>
          ) : null}
          {item.note ? <span className="t-caption">โน้ต: {item.note}</span> : null}
        </div>
        {canEdit ? (
          <div className="row" style={{ gap: 4, flexShrink: 0 }}>
            <button
              type="button"
              className={column.item.className}
              disabled={pending}
              onClick={() => runById(column.item.run, item.id)}
              aria-label={`${column.item.label} ${item.menuItemName}`}
            >
              {column.item.label}
            </button>
            {column.key === "AWAITING_KITCHEN" && canCancel ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={pending}
                onClick={() => setCancelling({ item, label })}
                aria-label={`ยกเลิก ${item.menuItemName}`}
              >
                ยกเลิก
              </button>
            ) : null}
          </div>
        ) : null}
      </li>
    )
  }

  return (
    <>
      <AutoRefresh seconds={10} />
      {printQueue.length > 0 ? <AutoPrint orderIds={printQueue} /> : null}

      <div className="page-head">
        <div>
          <p className="t-eyebrow">MJD Mobile Order</p>
          <h1 className="t-h1">
            <span className="row" style={{ gap: 10 }}>
              <IconKitchen size={22} aria-hidden />
              Kitchen Display
            </span>
          </h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            กดที่รายการเพื่อเริ่ม/เสร็จ/เสิร์ฟทีละจาน หรือกดปุ่มท้ายการ์ดเพื่อทำทั้งใบ
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {pending ? <IconSpinner size={20} className="animate-spin" aria-hidden /> : null}
          {alertSound ? (
            <button
              type="button"
              className={`btn btn-sm ${soundOn ? "btn-primary" : "btn-subtle"}`}
              onClick={toggleSound}
              title={soundOn ? "ปิดเสียงเตือนบนเครื่องนี้" : "เปิดเสียงเตือนเมื่อมีออร์เดอร์ใหม่ (ต้องกดเปิดครั้งแรกบนแต่ละเครื่อง)"}
            >
              {soundOn ? <IconSoundOn size={15} aria-hidden /> : <IconSoundOff size={15} aria-hidden />}
              {soundOn ? "เสียงเตือนเปิดอยู่" : "เปิดเสียงเตือน"}
            </button>
          ) : null}
        </div>
      </div>

      {stations.length > 0 ? (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 16 }} role="tablist" aria-label="ประเภทครัว">
          <button
            type="button"
            role="tab"
            aria-selected={!stationFilter}
            className={`btn btn-sm ${!stationFilter ? "btn-primary" : "btn-subtle"}`}
            onClick={() => selectStation(null)}
          >
            <IconStation size={14} aria-hidden />
            ทุกครัว
          </button>
          {stations.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={stationFilter === s.id}
              className={`btn btn-sm ${stationFilter === s.id ? "btn-primary" : "btn-subtle"}`}
              onClick={() => selectStation(s.id)}
            >
              {s.name}
            </button>
          ))}
          {hasUnassigned ? (
            <button
              type="button"
              role="tab"
              aria-selected={stationFilter === STATION_NONE}
              className={`btn btn-sm ${stationFilter === STATION_NONE ? "btn-primary" : "btn-subtle"}`}
              onClick={() => selectStation(STATION_NONE)}
            >
              {UNASSIGNED_STATION_LABEL}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="kds-columns">
        {COLUMNS.map((column) => {
          const columnTickets = ticketsFor(column.key)
          const itemCount = columnTickets.reduce((sum, t) => sum + t.items.length, 0)

          return (
            <section key={column.key} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className={`chip ${column.chip}`}>
                  <span className="dot" />
                  {column.title}
                </span>
                <span className="t-caption num">{formatNumber(itemCount)} รายการ</span>
              </div>

              {columnTickets.length === 0 ? (
                <div className="card-ui card-pad">
                  <p className="t-caption">ไม่มีรายการ</p>
                </div>
              ) : (
                columnTickets.map((ticket) => {
                  const label = ticket.orderType === "TAKEAWAY" ? ticket.tableCode : `โต๊ะ ${ticket.tableCode}`
                  return (
                    <article
                      key={`${ticket.orderId}-${column.key}`}
                      className="card-ui card-pad"
                      style={{ display: "flex", flexDirection: "column", gap: 8 }}
                    >
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <span style={{ fontWeight: 700 }}>{label}</span>
                        <LiveElapsed since={ticket.submittedAt} />
                      </div>
                      <span className="t-caption num">
                        ออร์เดอร์ที่ {ticket.orderNumber} · รับเมื่อ {formatClock(ticket.submittedAt)}
                      </span>

                      <ul
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                          borderTop: "1px solid var(--line)",
                          paddingTop: 8,
                        }}
                      >
                        {ticket.items.map((item) => renderItem(item, column, label))}
                        {ticket.cancelled.map((item) => (
                          <li
                            key={item.id}
                            className="t-caption"
                            style={{ textDecoration: "line-through", color: "var(--ink-3)" }}
                            title={item.cancelReason ? `ยกเลิก: ${item.cancelReason}` : "ยกเลิกแล้ว"}
                          >
                            <span className="num">{formatNumber(item.quantity)}×</span> {item.menuItemName} — ยกเลิกแล้ว
                            {item.cancelReason ? ` (${item.cancelReason})` : ""}
                          </li>
                        ))}
                      </ul>

                      <div className="row" style={{ gap: 8 }}>
                        {canEdit && ticket.items.length > 1 ? (
                          <button
                            type="button"
                            className={column.order.className}
                            disabled={pending}
                            onClick={() => runById(column.order.run, ticket.orderId)}
                            style={{ flex: 1 }}
                          >
                            {column.order.label}
                          </button>
                        ) : null}
                        {/* พิมพ์ผ่าน PDF แทนเครื่องพิมพ์ความร้อน (Phase 8) — เปิดแท็บใหม่แล้วเด้งกล่องพิมพ์ให้เลย */}
                        <a
                          href={`/tickets/${ticket.orderId}?auto=1`}
                          target="_blank"
                          rel="noopener"
                          className="btn btn-subtle btn-sm"
                          title="เปิดทิกเก็ตเพื่อพิมพ์หรือบันทึกเป็น PDF"
                        >
                          <IconReceipt size={15} aria-hidden />
                          ทิกเก็ต
                        </a>
                      </div>
                    </article>
                  )
                })
              )}
            </section>
          )
        })}
      </div>

      <Dialog open={cancelling !== null} onOpenChange={(open) => !open && setCancelling(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ยกเลิก {cancelling?.item.menuItemName}</DialogTitle>
            <DialogDescription>
              {cancelling?.label} · ยกเลิกได้เฉพาะรายการที่ครัวยังไม่เริ่มทำ — ถ้าอีกเครื่องกด “เริ่ม” ไปก่อน ระบบจะปฏิเสธให้เอง
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCancel} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="field">
              <label className="t-small" htmlFor="kds-cancel-reason">
                เหตุผล <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                id="kds-cancel-reason"
                className="input"
                required
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="เช่น วัตถุดิบหมด / ลูกค้าขอเปลี่ยน"
                autoFocus
              />
            </div>
            <DialogFooter>
              <button type="button" className="btn btn-subtle" onClick={() => setCancelling(null)} disabled={pending}>
                ปิด
              </button>
              <button type="submit" className="btn btn-danger-solid" disabled={pending || reason.trim() === ""}>
                {pending ? <IconSpinner size={16} className="animate-spin" aria-hidden /> : null}
                ยืนยันยกเลิกรายการ
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
