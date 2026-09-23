"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createTable, createTablesBulk, renameTable, deleteTable } from "@/app/actions/tables"
import { formatNumber } from "@/lib/format"
import type { KitchenStationRow, ManagedTable } from "@/lib/queries"
import { FULL_ACCESS, type AllowedActions, type FieldErrors } from "@/lib/types"
import { IconBack, IconPlus, IconSpinner, IconTable, IconTrash } from "@/components/icons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const STATUS_LABEL: Record<ManagedTable["status"], string> = {
  EMPTY: "ว่าง",
  OPEN_NO_ORDER: "เปิดแล้ว ยังไม่สั่ง",
  ORDERED: "สั่งอาหารแล้ว",
  AWAITING_BILL: "รอเช็กบิล",
  OCCUPIED_MERGED: "ถูกรวมกับโต๊ะอื่น",
}

/// Phase 20 (ร้านนวด): `spaEnabled` เปิดตัวเลือก "โต๊ะอาหาร / ห้องนวด" + ประเภทห้อง (จาก `stations`) ตอนเพิ่ม/แก้
export function TableAdmin({
  tables,
  allowed = FULL_ACCESS,
  spaEnabled = false,
  stations = [],
}: {
  tables: ManagedTable[]
  allowed?: AllowedActions
  spaEnabled?: boolean
  stations?: KitchenStationRow[]
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const [single, setSingle] = useState("")
  const [singleKind, setSingleKind] = useState<"TABLE" | "ROOM">("TABLE")
  const [singleStation, setSingleStation] = useState("")
  const [prefix, setPrefix] = useState("T")
  const [from, setFrom] = useState("1")
  const [to, setTo] = useState("10")

  const [renaming, setRenaming] = useState<ManagedTable | null>(null)
  const [newCode, setNewCode] = useState("")
  const [newKind, setNewKind] = useState<"TABLE" | "ROOM">("TABLE")
  const [newStation, setNewStation] = useState("")
  const [removing, setRemoving] = useState<ManagedTable | null>(null)

  async function run(action: () => Promise<{ ok: boolean; message?: string; error?: string; fieldErrors?: FieldErrors }>) {
    setPending(true)
    setFieldErrors({})
    try {
      const result = await action()
      if (!result.ok) {
        toast.error(result.error ?? "ทำรายการไม่สำเร็จ")
        setFieldErrors(result.fieldErrors ?? {})
        return false
      }
      toast.success(result.message ?? "เรียบร้อยแล้ว")
      router.refresh()
      return true
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
      return false
    } finally {
      setPending(false)
    }
  }

  async function addSingle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData()
    formData.set("code", single)
    formData.set("kind", singleKind)
    formData.set("stationId", singleKind === "ROOM" ? singleStation : "")
    if (await run(() => createTable(formData))) setSingle("")
  }

  async function addBulk(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData()
    formData.set("prefix", prefix)
    formData.set("from", from)
    formData.set("to", to)
    await run(() => createTablesBulk(formData))
  }

  async function submitRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!renaming) return
    const formData = new FormData()
    formData.set("id", renaming.id)
    formData.set("code", newCode)
    formData.set("kind", newKind)
    formData.set("stationId", newKind === "ROOM" ? newStation : "")
    if (await run(() => renameTable(formData))) setRenaming(null)
  }

  async function confirmDelete() {
    if (!removing) return
    const formData = new FormData()
    formData.set("id", removing.id)
    if (await run(() => deleteTable(formData))) setRemoving(null)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">
            <Link href="/mobile-order/tables" className="row" style={{ gap: 6 }}>
              <IconBack size={14} aria-hidden /> กลับไปผังโต๊ะ
            </Link>
          </p>
          <h1 className="t-h1">จัดการโต๊ะ</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            เพิ่ม แก้รหัส หรือลบโต๊ะของร้าน — รหัสโต๊ะคือสิ่งที่ปรากฏบนทิกเก็ตครัวและใบเสร็จ
          </p>
        </div>
        <Link href="/mobile-order/qr-codes" className="btn btn-subtle">
          ไปสร้าง QR Code
        </Link>
      </div>

      {allowed.includes("ADD") ? (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, alignItems: "start" }}>
        <section className="card-ui card-pad">
          <h2 className="t-h2" style={{ marginBottom: 12 }}>
            เพิ่มทีละโต๊ะ
          </h2>
          <form onSubmit={addSingle} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="field">
              <label className="t-small" htmlFor="singleCode">
                รหัสโต๊ะ
              </label>
              <input
                id="singleCode"
                className="input"
                required
                maxLength={12}
                placeholder="เช่น A1 หรือ ระเบียง-2"
                value={single}
                onChange={(e) => setSingle(e.target.value)}
              />
              {fieldErrors.code ? <span className="field-hint error">{fieldErrors.code}</span> : null}
            </div>
            {spaEnabled ? (
              <KindPicker
                kind={singleKind}
                station={singleStation}
                stations={stations}
                onKind={setSingleKind}
                onStation={setSingleStation}
                error={fieldErrors.stationId}
              />
            ) : null}
            <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
              {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : <IconPlus size={17} aria-hidden />}
              เพิ่มโต๊ะ
            </button>
          </form>
        </section>

        <section className="card-ui card-pad">
          <h2 className="t-h2" style={{ marginBottom: 4 }}>
            เพิ่มเป็นชุด
          </h2>
          <p className="t-caption" style={{ marginBottom: 12 }}>
            เช่น คำนำหน้า <span className="num">T</span> ตั้งแต่ <span className="num">1</span> ถึง{" "}
            <span className="num">16</span> จะได้ T01…T16 · รหัสที่มีอยู่แล้วจะถูกข้ามไป
          </p>
          <form onSubmit={addBulk} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="field-grid">
              <div className="field">
                <label className="t-small" htmlFor="prefix">
                  คำนำหน้า
                </label>
                <input
                  id="prefix"
                  className="input"
                  maxLength={6}
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                />
              </div>
              <div className="field">
                <label className="t-small" htmlFor="from">
                  ตั้งแต่
                </label>
                <input
                  id="from"
                  className="input num"
                  inputMode="numeric"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
                {fieldErrors.from ? <span className="field-hint error">{fieldErrors.from}</span> : null}
              </div>
              <div className="field">
                <label className="t-small" htmlFor="to">
                  ถึง
                </label>
                <input
                  id="to"
                  className="input num"
                  inputMode="numeric"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
                {fieldErrors.to ? <span className="field-hint error">{fieldErrors.to}</span> : null}
              </div>
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
              {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : <IconTable size={17} aria-hidden />}
              เพิ่มเป็นชุด
            </button>
          </form>
        </section>
      </div>
      ) : null}

      <section className="card-ui">
        <div className="panel-head">
          <h2 className="t-h2">
            โต๊ะทั้งหมด <span className="num">{tables.length}</span> ตัว
          </h2>
        </div>

        {tables.length === 0 ? (
          <p className="t-body" style={{ padding: 24 }}>
            ยังไม่มีโต๊ะในระบบ — เพิ่มโต๊ะจากช่องด้านบนก่อน แล้วค่อยไปสร้าง QR Code ให้แต่ละโต๊ะ
          </p>
        ) : (
          <div className="datatable-wrap">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                  <th style={{ padding: "10px 24px", fontWeight: 500 }}>รหัสโต๊ะ</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>สถานะ</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500 }}>QR</th>
                  <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>เคยเปิดโต๊ะ</th>
                  <th style={{ padding: "10px 24px", fontWeight: 500, textAlign: "right" }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {tables.map((table) => {
                  const busy = table.status !== "EMPTY" || table.mergedInto !== null || table.mergedCount > 0
                  return (
                    <tr key={table.id} style={{ borderTop: "1px solid var(--line)" }}>
                      <td style={{ padding: "12px 24px", fontWeight: 600 }}>
                        {table.code}
                        {table.kind === "ROOM" ? (
                          <span className="t-caption" style={{ fontWeight: 400 }}> · ห้องนวด{table.stationName ? ` (${table.stationName})` : ""}</span>
                        ) : null}
                      </td>
                      <td style={{ padding: "12px" }}>
                        <span className={`chip ${table.status === "EMPTY" ? "chip-neutral" : "chip-warning"}`}>
                          <span className="dot" />
                          {STATUS_LABEL[table.status]}
                        </span>
                        {table.mergedInto ? (
                          <span className="t-caption"> · รวมอยู่กับโต๊ะ {table.mergedInto}</span>
                        ) : null}
                      </td>
                      <td className="t-caption" style={{ padding: "12px" }}>
                        {table.hasActiveQr ? "มี QR ใช้งานอยู่" : "ยังไม่มี QR"}
                      </td>
                      <td className="num t-caption" style={{ padding: "12px", textAlign: "right" }}>
                        {formatNumber(table.sessionCount)} ครั้ง
                      </td>
                      <td style={{ padding: "12px 24px", textAlign: "right" }}>
                        <span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                          {allowed.includes("EDIT") ? (
                          <button
                            type="button"
                            className="btn btn-subtle btn-sm"
                            disabled={pending || busy}
                            title={busy ? "โต๊ะกำลังใช้งานอยู่ แก้ไม่ได้" : undefined}
                            onClick={() => {
                              setNewCode(table.code)
                              setNewKind(table.kind)
                              setNewStation(table.stationId ?? "")
                              setRenaming(table)
                            }}
                          >
                            แก้รหัส
                          </button>
                          ) : null}
                          {allowed.includes("DELETE") ? (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={pending || busy || table.sessionCount > 0}
                            title={
                              table.sessionCount > 0
                                ? "เคยเปิดโต๊ะแล้ว ลบไม่ได้ — ผูกกับบิลที่ออกไปแล้ว"
                                : undefined
                            }
                            onClick={() => setRemoving(table)}
                          >
                            <IconTrash size={15} aria-hidden />
                          </button>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={renaming !== null} onOpenChange={(next) => !next && setRenaming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>แก้รหัสโต๊ะ {renaming?.code}</DialogTitle>
            <DialogDescription>
              รหัสใหม่จะปรากฏบนทิกเก็ตครัวและใบเสร็จของบิลถัดไป — บิลเก่าที่ออกไปแล้วไม่เปลี่ยน
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitRename} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="field">
              <label className="t-small" htmlFor="newCode">
                รหัสใหม่
              </label>
              <input
                id="newCode"
                className="input"
                required
                autoFocus
                maxLength={12}
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
              />
              {fieldErrors.code ? <span className="field-hint error">{fieldErrors.code}</span> : null}
            </div>
            {spaEnabled ? (
              <KindPicker
                kind={newKind}
                station={newStation}
                stations={stations}
                onKind={setNewKind}
                onStation={setNewStation}
                error={fieldErrors.stationId}
              />
            ) : null}
            <DialogFooter>
              <button type="button" className="btn btn-ghost" onClick={() => setRenaming(null)}>
                ยกเลิก
              </button>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
                บันทึก
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(next) => !next && setRemoving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ลบโต๊ะ {removing?.code}</DialogTitle>
            <DialogDescription>
              ลบได้เฉพาะโต๊ะที่ว่างและยังไม่เคยเปิดใช้งาน — QR ของโต๊ะนี้จะถูกลบไปด้วย
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className="btn btn-ghost" onClick={() => setRemoving(null)}>
              ไม่ลบ
            </button>
            <button type="button" className="btn btn-danger-solid" disabled={pending} onClick={confirmDelete}>
              {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
              ยืนยันลบ
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/// ตัวเลือก "โต๊ะอาหาร / ห้องนวด" + ประเภทห้อง (Phase 20) — ใช้ทั้งตอนเพิ่มและตอนแก้
function KindPicker({
  kind,
  station,
  stations,
  onKind,
  onStation,
  error,
}: {
  kind: "TABLE" | "ROOM"
  station: string
  stations: KitchenStationRow[]
  onKind: (kind: "TABLE" | "ROOM") => void
  onStation: (id: string) => void
  error?: string
}) {
  return (
    <div className="field">
      <span className="t-small">ชนิด</span>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className={`btn btn-sm ${kind === "TABLE" ? "btn-primary" : "btn-subtle"}`} onClick={() => onKind("TABLE")}>
          โต๊ะอาหาร
        </button>
        <button type="button" className={`btn btn-sm ${kind === "ROOM" ? "btn-primary" : "btn-subtle"}`} onClick={() => onKind("ROOM")}>
          ห้องนวด
        </button>
      </div>
      {kind === "ROOM" ? (
        <>
          <select className="select" value={station} onChange={(e) => onStation(e.target.value)} aria-label="ประเภทห้อง" style={{ marginTop: 6 }}>
            <option value="">ห้องทั่วไป (ใช้ได้ทุกประเภทบริการ)</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="field-hint">ประเภทห้อง เช่น ห้องนวดเท้า / ห้องนวดไทย — ตารางจอง (20b) จะเสนอเฉพาะห้องที่ตรงกับโปรแกรม</span>
          {error ? <span className="field-hint error">{error}</span> : null}
        </>
      ) : null}
    </div>
  )
}
