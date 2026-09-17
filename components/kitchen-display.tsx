"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { startCookingOrder, markOrderReady, markOrderServed } from "@/app/actions/orders"
import { formatClock, formatNumber } from "@/lib/format"
import type { KitchenTicket, OrderItemRow } from "@/lib/queries"
import { LiveElapsed } from "@/components/live-elapsed"
import { AutoRefresh } from "@/components/auto-refresh"
import { IconKitchen, IconReceipt, IconSpinner } from "@/components/icons"

type Column = {
  key: "AWAITING_KITCHEN" | "COOKING" | "READY"
  title: string
  chip: string
  action?: { label: string; className: string; run: (formData: FormData) => Promise<unknown> }
}

/// กระดาน 3 คอลัมน์ของครัว — ใช้เฉพาะร้านที่เปิด `hasKDS` เท่านั้น
/// ร้านที่ปิดไว้ถูกกันตั้งแต่ที่หน้า (app/(staff)/(app)/mobile-order/kitchen/page.tsx)
/// จึงไม่ต้องมีสาขาโหมดไม่มี KDS ในนี้อีก
export function KitchenDisplay({ tickets, canEdit = true }: { tickets: KitchenTicket[]; canEdit?: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const columns: Column[] = [
    {
      key: "AWAITING_KITCHEN",
      title: "ออร์เดอร์ใหม่",
      chip: "chip-danger",
      action: { label: "เริ่มปรุง", className: "btn btn-primary btn-sm btn-block", run: startCookingOrder },
    },
    {
      key: "COOKING",
      title: "กำลังปรุง",
      chip: "chip-warning",
      action: { label: "ทำเสร็จแล้ว", className: "btn btn-accent btn-sm btn-block", run: markOrderReady },
    },
    {
      key: "READY",
      title: "พร้อมเสิร์ฟ",
      chip: "chip-success",
      action: { label: "เสิร์ฟแล้ว", className: "btn btn-subtle btn-sm btn-block", run: markOrderServed },
    },
  ]

  async function handle(action: (formData: FormData) => Promise<unknown>, targetId: string) {
    setPending(true)
    const formData = new FormData()
    formData.set("id", targetId)
    try {
      const result = (await action(formData)) as { ok: boolean; message?: string; error?: string }
      if (!result.ok) {
        toast.error(result.error ?? "เปลี่ยนสถานะไม่สำเร็จ")
        // สถานะอาจถูกเปลี่ยนจากอีกเครื่องไปแล้ว — ดึงข้อมูลใหม่ให้เห็นของจริงทันที
        router.refresh()
        return
      }
      toast.success(result.message ?? "อัปเดตแล้ว")
      router.refresh()
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  function ticketsFor(status: Column["key"]) {
    return tickets
      .map((ticket) => ({ ...ticket, items: ticket.items.filter((i) => i.status === status) }))
      .filter((ticket) => ticket.items.length > 0)
  }

  function renderItem(item: OrderItemRow) {
    return (
      <li key={item.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span>
          <span className="num" style={{ fontWeight: 700 }}>
            {formatNumber(item.quantity)}×
          </span>{" "}
          {item.menuItemName}
        </span>
        {item.options.length > 0 ? (
          <span className="t-caption" style={{ color: "var(--brand-strong)" }}>
            ({item.options.map((o) => o.optionName).join(", ")})
          </span>
        ) : null}
        {item.note ? <span className="t-caption">โน้ต: {item.note}</span> : null}
      </li>
    )
  }

  return (
    <>
      <AutoRefresh seconds={10} />

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
            หน้าจอครัว — กดเริ่มปรุงเมื่อรับออร์เดอร์ และกดทำเสร็จเมื่อพร้อมเสิร์ฟ
          </p>
        </div>
        {pending ? <IconSpinner size={20} className="animate-spin" aria-hidden /> : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16, alignItems: "start" }}>
        {columns.map((column) => {
          const columnTickets = ticketsFor(column.key)
          const itemCount = columnTickets.reduce((sum, t) => sum + t.items.length, 0)

          const action = column.action

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
                columnTickets.map((ticket) => (
                  <article
                    key={`${ticket.orderId}-${column.key}`}
                    className="card-ui card-pad"
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 700 }}>{ticket.orderType === "TAKEAWAY" ? ticket.tableCode : `โต๊ะ ${ticket.tableCode}`}</span>
                      <LiveElapsed since={ticket.submittedAt} />
                    </div>
                    <span className="t-caption num">
                      ออร์เดอร์ที่ {ticket.orderNumber} · รับเมื่อ {formatClock(ticket.submittedAt)}
                    </span>

                    <ul
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        borderTop: "1px solid var(--line)",
                        paddingTop: 8,
                      }}
                    >
                      {ticket.items.map(renderItem)}
                    </ul>

                    <div className="row" style={{ gap: 8 }}>
                      {action && canEdit ? (
                        <button
                          type="button"
                          className={action.className}
                          disabled={pending}
                          onClick={() => void handle(action.run, ticket.orderId)}
                          style={{ flex: 1 }}
                        >
                          {action.label}
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
                ))
              )}
            </section>
          )
        })}
      </div>
    </>
  )
}
