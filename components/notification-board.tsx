"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  acknowledgeNotification,
  acknowledgeAllNotifications,
} from "@/app/actions/notifications"
import Link from "next/link"
import { formatBaht, formatClock, formatDateTime, formatNumber } from "@/lib/format"
import type { BookingRow, CustomerPaidBill, NotificationCard, PaymentAwaitingCallback } from "@/lib/queries"
import { LiveElapsed } from "@/components/live-elapsed"
import { AutoRefresh } from "@/components/auto-refresh"
import { AwaitingCallbackBadge, CustomerPaidBadge } from "@/components/payment-alerts"
import { IconBell, IconCalendar, IconReceipt, IconSpinner, IconWarning } from "@/components/icons"

export function NotificationBoard({
  notifications,
  awaitingCallback = [],
  paidBills = [],
  upcomingBookings = [],
  canAcknowledge = true,
}: {
  notifications: NotificationCard[]
  awaitingCallback?: PaymentAwaitingCallback[]
  paidBills?: CustomerPaidBill[]
  /// คิวนวดที่ใกล้ถึงเวลาแล้วยังไม่เช็กอิน (Phase 20b) — คำนวณสด ไม่ใช่แถวใน Notification จึงไม่มีปุ่มรับทราบ
  upcomingBookings?: BookingRow[]
  /// MO_NOTIFICATIONS:EDIT — ไม่มี = ดูอย่างเดียว
  canAcknowledge?: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const waiting = notifications.filter((n) => n.status === "PENDING")
  const done = notifications.filter((n) => n.status === "ACKNOWLEDGED")

  // ป้าย "จ่ายแล้ว" และ "รอธนาคารยืนยัน" ต้องไปอยู่ในการ์ดของโต๊ะที่แจ้งมา ไม่ใช่กรอบใหม่แยกต่างหาก
  const paidByTable = new Map<string, CustomerPaidBill>()
  for (const bill of paidBills) {
    if (bill.tableId && !paidByTable.has(bill.tableId)) paidByTable.set(bill.tableId, bill)
  }

  const awaitingByTable = new Map<string, PaymentAwaitingCallback>()
  for (const item of awaitingCallback) {
    if (!awaitingByTable.has(item.tableId)) awaitingByTable.set(item.tableId, item)
  }

  const notifiedTables = new Set(notifications.map((n) => n.tableId))
  const orphanAwaiting = awaitingCallback.filter((item) => !notifiedTables.has(item.tableId))

  async function run(action: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setPending(true)
    try {
      const result = await action()
      if (!result.ok) {
        toast.error(result.error ?? "ทำรายการไม่สำเร็จ")
        return
      }
      toast.success(result.message ?? "ทำรายการเรียบร้อยแล้ว")
      router.refresh()
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  function acknowledge(id: string) {
    const formData = new FormData()
    formData.set("id", id)
    void run(() => acknowledgeNotification(formData))
  }

  function renderCard(item: NotificationCard, urgent: boolean) {
    const isCall = item.type === "CALL_STAFF"
    return (
      <article
        key={item.id}
        className="card-ui card-pad"
        style={{ display: "flex", flexDirection: "column", gap: 8, opacity: urgent ? 1 : 0.8 }}
      >
        <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
          <span className="row" style={{ gap: 8 }}>
            {isCall ? <IconBell size={17} aria-hidden /> : <IconReceipt size={17} aria-hidden />}
            <span style={{ fontWeight: 700 }}>
              โต๊ะ {item.tableCode} · {isCall ? "เรียกพนักงาน" : "ขอเช็กบิล"}
            </span>
          </span>
          <span className={`chip ${urgent ? (isCall ? "chip-danger" : "chip-warning") : "chip-success"}`}>
            <span className="dot" />
            {urgent ? "รอรับทราบ" : "รับทราบแล้ว"}
          </span>
        </div>

        {item.reason ? <p className="t-small">{item.reason}</p> : null}

        {/* โต๊ะที่แจ้งมาแล้วลูกค้าจ่ายเองเรียบร้อย — ต้องเห็นในการ์ดใบเดียวกับที่แจ้ง ไม่ใช่กรอบใหม่ */}
        {paidByTable.has(item.tableId) ? <CustomerPaidBadge bill={paidByTable.get(item.tableId)!} /> : null}

        {/* เช่นเดียวกับใบที่ออก QR ไปแล้วธนาคารยังไม่ยืนยัน */}
        {awaitingByTable.has(item.tableId) ? (
          <AwaitingCallbackBadge item={awaitingByTable.get(item.tableId)!} />
        ) : null}

        {/* 2 จุดเวลาที่ F12 บังคับให้แสดงเสมอ: เวลาที่เปิดโต๊ะ และเปิดมาแล้วกี่นาที */}
        <span className="t-caption">
          เปิดโต๊ะ <span className="num">{formatClock(item.openedAt)}</span> ·{" "}
          <LiveElapsed since={item.openedAt} prefix="เปิดมาแล้ว " />
        </span>

        <span className="row" style={{ justifyContent: "space-between" }}>
          <span className="t-caption">
            แจ้งเมื่อ <span className="num">{formatDateTime(item.createdAt)}</span>
          </span>
          {item.sessionTotal > 0 ? (
            <span className="t-small num" style={{ fontWeight: 600 }}>
              ยอดรวม ฿{formatBaht(item.sessionTotal)}
            </span>
          ) : null}
        </span>

        {urgent && !canAcknowledge ? (
          <span className="t-caption">รอพนักงานที่มีสิทธิ์กดรับทราบ</span>
        ) : urgent ? (
          <button
            type="button"
            className={isCall ? "btn btn-danger btn-block btn-sm" : "btn btn-primary btn-block btn-sm"}
            disabled={pending}
            onClick={() => acknowledge(item.id)}
          >
            รับทราบ
          </button>
        ) : (
          <span className="t-caption">
            ✓ ดำเนินการแล้ว
            {item.acknowledgedByName ? ` โดย ${item.acknowledgedByName}` : ""}
            {item.acknowledgedAt ? ` · ${formatDateTime(item.acknowledgedAt)}` : ""}
          </span>
        )}
      </article>
    )
  }

  return (
    <>
      <AutoRefresh seconds={8} />

      <div className="page-head">
        <div>
          <p className="t-eyebrow">MJD Mobile Order</p>
          <h1 className="t-h1">การแจ้งเตือน</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            การรับทราบเป็นแค่ป้ายซ้อนทับ ไม่เปลี่ยนสถานะของโต๊ะ
          </p>
        </div>
        {waiting.length > 0 && canAcknowledge ? (
          <button
            type="button"
            className="btn btn-subtle"
            disabled={pending}
            onClick={() => void run(() => acknowledgeAllNotifications())}
          >
            {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
            รับทราบทั้งหมด
          </button>
        ) : null}
      </div>

      {/* ★ โต๊ะที่รอธนาคารยืนยันแต่ **ไม่มีการ์ดแจ้งเตือนของตัวเอง** ให้ไปเกาะ
          (เช่น พนักงานลบ/ไม่มีใบ CHECK_BILL) — ที่เหลือขึ้นในการ์ดของโต๊ะนั้นแทน
          ห้ามตัดทิ้งเฉย ๆ เพราะรายการนี้ถูกนับรวมใน badge ของ sidebar ถ้าไม่แสดงที่ไหนเลย
          พนักงานจะเห็นตัวเลขค้างแล้วหาที่มาไม่เจอ */}
      {orphanAwaiting.length > 0 ? (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 className="t-h3" style={{ color: "var(--warning)" }}>
            รอธนาคารยืนยันนานผิดปกติ · <span className="num">{formatNumber(orphanAwaiting.length)}</span>
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
            {orphanAwaiting.map((item) => (
              <article
                key={item.intentId}
                className="card-ui card-pad"
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
              >
                <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
                  <span className="row" style={{ gap: 8 }}>
                    <IconWarning size={17} aria-hidden />
                    <span style={{ fontWeight: 700 }}>โต๊ะ {item.tableCode}</span>
                  </span>
                  <span className="chip chip-warning">
                    <span className="dot" />
                    ต้องตรวจสอบ
                  </span>
                </div>

                <AwaitingCallbackBadge item={item} />

                <Link
                  href={`/mobile-order/tables/${item.tableId}/billing`}
                  className="btn btn-subtle btn-block btn-sm"
                >
                  เปิดหน้าปิดบิลของโต๊ะนี้
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {/* คิวนวดที่ใกล้ถึงเวลา (Phase 20b) — ถูกนับรวมใน badge ของ sidebar เหมือนใบรอธนาคารยืนยัน
          จึงต้องมีที่แสดงเสมอ ไม่งั้นพนักงานเห็นตัวเลขค้างแล้วหาที่มาไม่เจอ · ไม่มีปุ่มรับทราบ
          เพราะรายการนี้หายเองเมื่อเช็กอิน/ยกเลิก */}
      {upcomingBookings.length > 0 ? (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 className="t-h3" style={{ color: "var(--warning)" }}>
            คิวนวดที่ใกล้ถึงเวลา · <span className="num">{formatNumber(upcomingBookings.length)}</span>
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
            {upcomingBookings.map((booking) => (
              <article key={booking.id} className="card-ui card-pad" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
                  <span className="row" style={{ gap: 8 }}>
                    <IconCalendar size={17} aria-hidden />
                    <span style={{ fontWeight: 700 }}>{booking.customerName}</span>
                  </span>
                  <span className="chip chip-info">
                    <span className="dot" />
                    <span className="num">{formatClock(booking.startAt)}</span>
                  </span>
                </div>
                <span className="t-small">
                  {booking.menuItemName} · {booking.therapistLabel}
                  {booking.tableCode ? ` · ห้อง ${booking.tableCode}` : " · ยังไม่เลือกห้อง"}
                </span>
                {booking.customerPhone ? <span className="t-caption num">{booking.customerPhone}</span> : null}
                <Link href={`/spa/bookings?date=${booking.startAt.toISOString().slice(0, 10)}`} className="btn btn-subtle btn-block btn-sm">
                  เปิดตารางจองเพื่อเช็กอิน
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 className="t-h3" style={{ color: "var(--danger)" }}>
          ต้องการความช่วยเหลือด่วน · <span className="num">{formatNumber(waiting.length)}</span>
        </h2>
        {waiting.length === 0 ? (
          <div className="card-ui card-pad">
            <p className="t-body">ไม่มีการแจ้งเตือนที่รอรับทราบ</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
            {waiting.map((n) => renderCard(n, true))}
          </div>
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 className="t-h3">รับทราบแล้ว</h2>
        {done.length === 0 ? (
          <div className="card-ui card-pad">
            <p className="t-body">ยังไม่มีรายการที่รับทราบ</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
            {done.map((n) => renderCard(n, false))}
          </div>
        )}
      </section>
    </>
  )
}
