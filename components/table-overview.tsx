"use client"

import { FULL_ACCESS, type AllowedActions } from "@/lib/types"
import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  openTableSession,
  mergeTables,
  unmergeTables,
  cancelTableSession,
} from "@/app/actions/tables"
import { acknowledgeNotification } from "@/app/actions/notifications"
import { formatBaht, formatClock, formatNumber } from "@/lib/format"
import type { CustomerPaidBill, PaymentAwaitingCallback, TableCard } from "@/lib/queries"
import { LiveElapsed } from "@/components/live-elapsed"
import { AutoRefresh } from "@/components/auto-refresh"
import { IconBell, IconMerge, IconReceipt, IconSpinner, IconTable } from "@/components/icons"
import { AwaitingCallbackBadge, CustomerPaidBadge } from "@/components/payment-alerts"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Filter = "all" | "empty" | "active" | "awaiting" | "help"

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "empty", label: "ว่าง" },
  { key: "active", label: "กำลังใช้บริการ" },
  { key: "awaiting", label: "รอเช็กบิล" },
  { key: "help", label: "ต้องการความช่วยเหลือ" },
]

const STATUS_LABEL: Record<TableCard["status"], string> = {
  EMPTY: "ว่าง",
  OPEN_NO_ORDER: "เปิดโต๊ะ · ยังไม่สั่งอาหาร",
  ORDERED: "สั่งอาหารแล้ว",
  AWAITING_BILL: "รอเช็กบิล",
  OCCUPIED_MERGED: "รวมกับโต๊ะอื่น",
}

const STATUS_CHIP: Record<TableCard["status"], string> = {
  EMPTY: "chip-neutral",
  OPEN_NO_ORDER: "chip-info",
  ORDERED: "chip-brand",
  AWAITING_BILL: "chip-warning",
  OCCUPIED_MERGED: "chip-neutral",
}

function matchesFilter(table: TableCard, filter: Filter): boolean {
  switch (filter) {
    case "empty":
      return table.status === "EMPTY"
    case "active":
      return table.status === "OPEN_NO_ORDER" || table.status === "ORDERED"
    case "awaiting":
      return table.status === "AWAITING_BILL"
    case "help":
      return table.pendingNotification !== null
    default:
      return true
  }
}

export function TableOverview({
  tables,
  paidBills = [],
  awaitingCallback = [],
  allowed = FULL_ACCESS,
  canAcknowledge = true,
}: {
  tables: TableCard[]
  paidBills?: CustomerPaidBill[]
  awaitingCallback?: PaymentAwaitingCallback[]
  /// สิทธิ์บน MO_TABLES (§4 · Phase 16): ADD เปิด/รวมโต๊ะ · EDIT ปิดบิล · DELETE ยกเลิกโต๊ะ — ซ่อนปุ่ม ด่านจริงอยู่ที่ action
  allowed?: AllowedActions
  /// MO_NOTIFICATIONS:EDIT — กดรับทราบได้
  canAcknowledge?: boolean
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>("all")
  const [pending, setPending] = useState(false)
  const [merging, setMerging] = useState<TableCard | null>(null)
  const [mergeTarget, setMergeTarget] = useState("")
  const [cancelling, setCancelling] = useState<TableCard | null>(null)
  const [cancelReason, setCancelReason] = useState("")

  const counts = useMemo(
    () => ({
      all: tables.length,
      empty: tables.filter((t) => matchesFilter(t, "empty")).length,
      active: tables.filter((t) => matchesFilter(t, "active")).length,
      awaiting: tables.filter((t) => matchesFilter(t, "awaiting")).length,
      help: tables.filter((t) => matchesFilter(t, "help")).length,
    }),
    [tables],
  )

  const visible = tables.filter((t) => matchesFilter(t, filter))
  const emptyTables = tables.filter((t) => t.status === "EMPTY")

  // จับคู่บิลที่เพิ่งชำระเข้ากับการ์ดของโต๊ะนั้น — ป้ายต้องอยู่ในกรอบเดิมของโต๊ะ ไม่ใช่กรอบใหม่
  const paidByTable = useMemo(() => {
    const map = new Map<string, CustomerPaidBill>()
    for (const bill of paidBills) {
      if (bill.tableId && !map.has(bill.tableId)) map.set(bill.tableId, bill)
    }
    return map
  }, [paidBills])

  // เช่นเดียวกับใบที่รอธนาคารยืนยัน — ขึ้นในกรอบของโต๊ะที่ออก QR ไว้
  const awaitingByTable = useMemo(() => {
    const map = new Map<string, PaymentAwaitingCallback>()
    for (const item of awaitingCallback) {
      if (!map.has(item.tableId)) map.set(item.tableId, item)
    }
    return map
  }, [awaitingCallback])

  async function run(action: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setPending(true)
    try {
      const result = await action()
      if (!result.ok) {
        toast.error(result.error ?? "ทำรายการไม่สำเร็จ")
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

  function handleOpen(table: TableCard) {
    const formData = new FormData()
    formData.set("tableId", table.id)
    void run(() => openTableSession(formData))
  }

  function handleAcknowledge(notificationId: string) {
    const formData = new FormData()
    formData.set("id", notificationId)
    void run(() => acknowledgeNotification(formData))
  }

  function handleUnmerge(table: TableCard) {
    const formData = new FormData()
    formData.set("secondaryTableId", table.id)
    void run(() => unmergeTables(formData))
  }

  async function handleMerge(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!merging || !mergeTarget) return
    const formData = new FormData()
    formData.set("primaryTableId", merging.id)
    formData.set("secondaryTableId", mergeTarget)
    const done = await run(() => mergeTables(formData))
    if (done) {
      setMerging(null)
      setMergeTarget("")
    }
  }

  async function handleCancel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!cancelling?.sessionId) return
    const formData = new FormData()
    formData.set("sessionId", cancelling.sessionId)
    formData.set("reason", cancelReason)
    const done = await run(() => cancelTableSession(formData))
    if (done) {
      setCancelling(null)
      setCancelReason("")
    }
  }

  return (
    <>
      <AutoRefresh seconds={12} />

      <div className="page-head">
        <div>
          <p className="t-eyebrow">MJD Mobile Order</p>
          <h1 className="t-h1">ผังโต๊ะ</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            เวลาเปิดโต๊ะและระยะเวลาที่เปิดคำนวณสดทุกนาทีจากเวลาที่ลูกค้าเริ่มใช้โต๊ะ
          </p>
        </div>
        <Link href="/mobile-order/tables/manage" className="btn btn-subtle">
          <IconTable size={17} aria-hidden />
          จัดการโต๊ะ
        </Link>
      </div>

      {tables.length === 0 ? (
        <div className="alert-banner warning">
          ยังไม่มีโต๊ะในระบบ — ไปที่ <Link href="/mobile-order/tables/manage">จัดการโต๊ะ</Link> เพื่อเพิ่มโต๊ะก่อน
          แล้วค่อยสร้าง QR Code ให้แต่ละโต๊ะ
        </div>
      ) : null}

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={f.key === filter ? "btn btn-primary btn-sm" : "btn btn-subtle btn-sm"}
            onClick={() => setFilter(f.key)}
          >
            {f.label} <span className="num">{formatNumber(counts[f.key])}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <section className="card-ui card-pad">
          <p className="t-body">ไม่มีโต๊ะตามเงื่อนไขที่เลือก</p>
        </section>
      ) : (
        <section
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 14 }}
        >
          {visible.map((table) => (
            <article
              key={table.id}
              className="card-ui card-pad"
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="row" style={{ gap: 8 }}>
                  <IconTable size={16} aria-hidden style={{ color: "var(--ink-3)" }} />
                  <span style={{ fontWeight: 700, fontSize: "1.05rem" }}>โต๊ะ {table.code}</span>
                </span>
                <span className={`chip ${STATUS_CHIP[table.status]}`}>
                  <span className="dot" />
                  {STATUS_LABEL[table.status]}
                </span>
              </div>

              {table.openedAt ? (
                <span className="t-caption">
                  เปิดโต๊ะ <span className="num">{formatClock(table.openedAt)}</span> ·{" "}
                  <LiveElapsed since={table.openedAt} />
                </span>
              ) : null}

              {/* บิลที่ลูกค้าจ่ายเองแล้วระบบปิดให้ — อยู่ในกรอบของโต๊ะที่จ่าย ไม่แยกไปกรอบใหม่ */}
              {paidByTable.has(table.id) ? <CustomerPaidBadge bill={paidByTable.get(table.id)!} /> : null}

              {/* ออก QR ไปแล้วแต่ธนาคารยังไม่ยืนยัน — อยู่ในกรอบเดียวกันเช่นกัน */}
              {awaitingByTable.has(table.id) ? (
                <AwaitingCallbackBadge item={awaitingByTable.get(table.id)!} />
              ) : null}

              {table.primaryTableCode ? (
                <span className="t-caption">
                  บิลรวมอยู่ที่{" "}
                  <Link href={`/mobile-order/tables/${table.primaryTableId}`}>
                    โต๊ะ {table.primaryTableCode}
                  </Link>
                </span>
              ) : null}

              {table.mergedTableCodes.length > 0 ? (
                <span className="t-caption">
                  รวมโต๊ะ {table.mergedTableCodes.map((c) => `โต๊ะ ${c}`).join(", ")} เข้ามาแล้ว
                </span>
              ) : null}

              {table.sessionId ? (
                <span className="row" style={{ justifyContent: "space-between" }}>
                  <span className="t-caption num">{formatNumber(table.itemCount)} รายการ</span>
                  <span className="num" style={{ fontWeight: 700 }}>
                    ฿{formatBaht(table.total)}
                  </span>
                </span>
              ) : null}

              {table.pendingNotification ? (
                <div className="alert-banner danger" style={{ padding: "8px 10px" }}>
                  <span className="row" style={{ gap: 6 }}>
                    {table.pendingNotification.type === "CALL_STAFF" ? (
                      <IconBell size={14} aria-hidden />
                    ) : (
                      <IconReceipt size={14} aria-hidden />
                    )}
                    <span className="t-small">
                      {table.pendingNotification.type === "CALL_STAFF" ? "เรียกพนักงาน" : "ขอเช็กบิล"}
                      {table.pendingNotification.reason ? ` · ${table.pendingNotification.reason}` : ""}
                    </span>
                  </span>
                  {canAcknowledge ? (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm btn-block"
                      style={{ marginTop: 8 }}
                      disabled={pending}
                      onClick={() => handleAcknowledge(table.pendingNotification!.id)}
                    >
                      รับทราบ
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className="row" style={{ gap: 6, marginTop: "auto", flexWrap: "wrap" }}>
                {table.status === "EMPTY" && allowed.includes("ADD") ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={pending}
                    onClick={() => handleOpen(table)}
                  >
                    เปิดโต๊ะ
                  </button>
                ) : null}

                {table.sessionId ? (
                  <>
                    <Link href={`/mobile-order/tables/${table.id}`} className="btn btn-primary btn-sm">
                      ดูออร์เดอร์
                    </Link>
                    {/* โต๊ะที่ลูกค้ากดเช็กบิลแล้ว ต้องกดปิดบิลได้จากผังโต๊ะเลย ไม่ต้องเข้าหน้ารายละเอียดก่อน */}
                    {table.status === "AWAITING_BILL" && allowed.includes("EDIT") ? (
                      <Link
                        href={`/mobile-order/tables/${table.id}/billing`}
                        className="btn btn-accent btn-sm"
                      >
                        ปิดบิล
                      </Link>
                    ) : null}
                    {allowed.includes("ADD") ? (
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm"
                        disabled={pending || emptyTables.length === 0}
                        title={emptyTables.length === 0 ? "ไม่มีโต๊ะว่างให้รวม" : undefined}
                        onClick={() => {
                          setMergeTarget("")
                          setMerging(table)
                        }}
                      >
                        <IconMerge size={15} aria-hidden /> รวมโต๊ะ
                      </button>
                    ) : null}
                    {allowed.includes("DELETE") ? (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={pending}
                        onClick={() => {
                          setCancelReason("")
                          setCancelling(table)
                        }}
                      >
                        ยกเลิกโต๊ะ
                      </button>
                    ) : null}
                  </>
                ) : null}

                {table.status === "OCCUPIED_MERGED" && allowed.includes("ADD") ? (
                  <button
                    type="button"
                    className="btn btn-subtle btn-sm"
                    disabled={pending}
                    onClick={() => handleUnmerge(table)}
                  >
                    ยกเลิกการรวม
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      )}

      <Dialog open={merging !== null} onOpenChange={(open) => !open && setMerging(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>รวมโต๊ะเข้ากับโต๊ะ {merging?.code}</DialogTitle>
            <DialogDescription>
              เลือกได้เฉพาะโต๊ะที่ว่างอยู่ — หลังรวมแล้วออร์เดอร์ทั้งหมดจะวิ่งเข้าบิลของโต๊ะ {merging?.code}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleMerge} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="field">
              <label className="t-small" htmlFor="secondaryTableId">
                โต๊ะที่จะรวมเข้ามา <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <select
                id="secondaryTableId"
                className="select"
                required
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
              >
                <option value="" disabled>
                  เลือกโต๊ะว่าง
                </option>
                {emptyTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    โต๊ะ {t.code}
                  </option>
                ))}
              </select>
            </div>

            <DialogFooter>
              <button type="button" className="btn btn-ghost" onClick={() => setMerging(null)}>
                ยกเลิก
              </button>
              <button type="submit" className="btn btn-primary" disabled={pending || !mergeTarget}>
                {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
                รวมโต๊ะ
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelling !== null} onOpenChange={(open) => !open && setCancelling(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ยกเลิกโต๊ะ {cancelling?.code}</DialogTitle>
            <DialogDescription>
              รายการอาหารที่ยังไม่เสิร์ฟจะถูกยกเลิกทั้งหมด และโต๊ะที่รวมอยู่จะกลับเป็นว่าง —
              ไม่มีการออกบิลเพราะยังไม่มีการชำระเงิน
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCancel} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="field">
              <label className="t-small" htmlFor="cancelReason">
                เหตุผล <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                id="cancelReason"
                className="input"
                required
                autoFocus
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="เช่น ลูกค้าเปลี่ยนใจ / เปิดโต๊ะผิด"
              />
            </div>

            <DialogFooter>
              <button type="button" className="btn btn-ghost" onClick={() => setCancelling(null)}>
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
