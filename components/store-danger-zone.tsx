"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { closeStore, deleteStore } from "@/app/actions/store-lifecycle"
import { IconSpinner, IconTrash } from "@/components/icons"

/// การ์ด "ปิดร้าน / ลบร้าน" ท้ายหน้าตั้งค่าร้าน (2026-09-30 · OWNER เท่านั้น)
///
/// `usageText` ว่าง = ร้านยังไม่เคยใช้งาน → ลบถาวรได้ · มีค่า = ลบไม่ได้ (บอกเหตุผล) ปิดร้านได้อย่างเดียว
/// ทั้งสองทางต้องพิมพ์ชื่อร้านให้ตรง · ปิดร้านต้องใส่เหตุผล — ด่านจริงอยู่ที่ action (lib/store-lifecycle.ts)
export function StoreDangerZone({ storeId, storeName, usageText }: { storeId: string; storeName: string; usageText: string }) {
  const router = useRouter()
  const canDelete = usageText === ""
  const [mode, setMode] = useState<"close" | "delete" | null>(null)
  const [confirmName, setConfirmName] = useState("")
  const [reason, setReason] = useState("")
  const [pending, setPending] = useState(false)

  const nameMatches = confirmName.trim() === storeName.trim()
  const ready = nameMatches && (mode === "delete" || reason.trim().length >= 5)

  function start(next: "close" | "delete") {
    setMode(next)
    setConfirmName("")
    setReason("")
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mode) return
    setPending(true)

    const formData = new FormData()
    formData.set("storeId", storeId)
    formData.set("confirmName", confirmName)
    formData.set("reason", reason)

    try {
      const result = mode === "delete" ? await deleteStore(formData) : await closeStore(formData)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      // ร้านนี้ใช้งานไม่ได้แล้ว — หน้าแรกจะพาไปร้านที่ยังเปิดอยู่ หรือ /no-store ถ้าไม่มี
      router.push("/")
      router.refresh()
    } catch {
      toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="card-ui card-pad" style={{ display: "flex", flexDirection: "column", gap: 14, borderColor: "var(--danger)" }}>
      <div>
        <h2 className="t-h2">ปิดร้าน / ลบร้าน</h2>
        <p className="t-caption" style={{ marginTop: 4 }}>
          {canDelete
            ? "ร้านนี้ยังไม่เคยใช้งาน (ไม่มีบิล ออร์เดอร์ สต็อก การจอง สมาชิก หรือการชำระค่าใช้งาน) จึงลบถาวรได้ หรือจะปิดไว้ก่อนก็ได้"
            : `ร้านนี้มีข้อมูลการใช้งานแล้ว (${usageText}) จึงลบไม่ได้ — ปิดร้านได้ ข้อมูลอยู่ครบ และเปิดกลับได้ภายหลัง`}
        </p>
      </div>

      {mode === null ? (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-danger" onClick={() => start("close")}>
            ปิดร้าน
          </button>
          {canDelete ? (
            <button type="button" className="btn btn-danger-solid" onClick={() => start("delete")}>
              <IconTrash size={16} aria-hidden />
              ลบร้านถาวร
            </button>
          ) : null}
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className={`alert-banner ${mode === "delete" ? "danger" : "warning"}`}>
            {mode === "delete"
              ? "ลบถาวร: ร้าน เมนู โต๊ะ QR พนักงานในร้าน และการตั้งค่าทั้งหมดจะหายไป กู้คืนไม่ได้"
              : "ปิดร้าน: พนักงานเข้าร้านไม่ได้ ลูกค้าสแกน QR ไม่ได้ ข้อมูลอยู่ครบ เจ้าของเปิดกลับได้ที่หน้า \"ร้านที่คุณปิดไว้\" (แพ็กเกจยังนับวันต่อ)"}
          </div>

          {mode === "close" ? (
            <div className="field">
              <label className="t-small" htmlFor="close-reason">
                เหตุผลที่ปิดร้าน <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                id="close-reason"
                className="input"
                required
                minLength={5}
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="เช่น ปิดกิจการ / ย้ายไปใช้ร้านใหม่"
              />
            </div>
          ) : null}

          <div className="field">
            <label className="t-small" htmlFor="confirm-name">
              พิมพ์ชื่อร้าน <strong>{storeName}</strong> เพื่อยืนยัน <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            <input
              id="confirm-name"
              className="input"
              required
              autoComplete="off"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
            />
          </div>

          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setMode(null)} disabled={pending}>
              ยกเลิก
            </button>
            <button type="submit" className="btn btn-danger-solid" disabled={pending || !ready}>
              {pending ? <IconSpinner size={17} className="animate-spin" aria-hidden /> : null}
              {mode === "delete" ? "ยืนยันลบร้านถาวร" : "ยืนยันปิดร้าน"}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
