"use client"

import { useRef, useState } from "react"
import { deleteStoreAsset, uploadStoreAsset } from "@/app/actions/assets"
import { ACCEPT_ATTRIBUTE, ASSET_JPEG_QUALITY, MAX_ASSET_BYTES, MAX_ASSET_EDGE } from "@/lib/assets"
import { IconImagePlus, IconSpinner, IconTrash } from "@/components/icons"

/// เลือกรูปจากเครื่อง/ถ่ายจากมือถือ แล้วอัปโหลดเก็บในระบบ (Phase 17a)
///
/// **ย่อในเบราว์เซอร์ก่อนส่งเสมอ** — รูปจากกล้องมือถือใบละ 3–5 MB ถ้าส่งดิบ ๆ จะเปลืองเน็ตของร้าน
/// และทำให้ฐานข้อมูล (ที่เก็บไบต์รูปไว้เอง) โตเร็วเกินจำเป็น · ด่านจริงเรื่องขนาด/ชนิดไฟล์อยู่ฝั่ง server
/// ที่ lib/assets.ts — ตรงนี้แค่ช่วยให้ผู้ใช้ไม่โดนปฏิเสธโดยไม่จำเป็น
///
/// ยังวางลิงก์รูปภายนอกได้เหมือนเดิม (ร้านที่มีรูปบนเว็บอยู่แล้วไม่ต้องอัปใหม่)

type Props = {
  /// ชื่อ field ที่ฟอร์มแม่จะอ่าน — component นี้คุมค่าเองผ่าน hidden input
  name: string
  value: string
  onChange: (value: string) => void
  label?: string
  hint?: string
  error?: string
  disabled?: boolean
}

async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_ASSET_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", ASSET_JPEG_QUALITY)
  })
  // canvas ใช้ไม่ได้ (เบราว์เซอร์เก่า/หน่วยความจำไม่พอ) → ส่งไฟล์เดิมไปให้ server ตัดสินแทน
  return blob ?? file
}

export function ImagePicker({ name, value, onChange, label, hint, error, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [linkMode, setLinkMode] = useState(false)
  /// รูปที่ "อัปในรอบนี้แต่ยังไม่ถูกบันทึก" — เปลี่ยน/ลบทิ้งก่อนกดบันทึกเมื่อไหร่ ลบออกจากฐานได้ทันที
  /// โดยไม่ต้องกลัวไปลบรูปของแถวที่บันทึกไว้แล้ว (รูปเดิมที่ถูกแทนที่ ถูกลบตอนกดบันทึกในทรานแซคชันเดียวกัน)
  const unsaved = useRef<Set<string>>(new Set())

  /// เปลี่ยนค่ารูป + เก็บกวาดรูปที่ยังไม่ถูกบันทึกซึ่งกำลังถูกทิ้ง
  function replaceValue(next: string) {
    const previous = value
    onChange(next)
    if (previous && previous !== next && unsaved.current.has(previous)) {
      unsaved.current.delete(previous)
      const fd = new FormData()
      fd.set("url", previous)
      // ลบเบื้องหลัง — ล้มเหลวก็แค่เหลือรูปกำพร้าในฐาน ไม่ควรขวางผู้ใช้
      void deleteStoreAsset(fd)
    }
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return

    setBusy(true)
    setLocalError(null)
    try {
      const blob = await shrinkImage(file)
      if (blob.size > MAX_ASSET_BYTES) {
        setLocalError(`รูปใหญ่เกินไปแม้ย่อแล้ว (สูงสุด ${Math.round(MAX_ASSET_BYTES / 1000)} KB) กรุณาเลือกรูปอื่น`)
        return
      }

      const fd = new FormData()
      fd.set("file", new File([blob], "image.jpg", { type: blob.type || "image/jpeg" }))
      const result = await uploadStoreAsset(fd)
      if (!result.ok) {
        setLocalError(result.error)
        return
      }
      const url = result.data?.url ?? ""
      if (url) unsaved.current.add(url)
      replaceValue(url)
    } catch {
      setLocalError("อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
    } finally {
      setBusy(false)
    }
  }

  const shownError = error ?? localError

  return (
    <div className="field">
      {label ? <span className="t-small">{label}</span> : null}
      <input type="hidden" name={name} value={value} />

      <div className="row" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        {value ? (
          /* eslint-disable-next-line @next/next/no-img-element -- รูปมาได้ทั้งจาก /api/assets และลิงก์ภายนอกที่ร้านกรอกเอง next/image ต้องประกาศโดเมนล่วงหน้า */
          <img
            src={value}
            alt="ตัวอย่างรูปที่เลือก"
            width={96}
            height={96}
            style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 12, border: "1px solid var(--line)" }}
          />
        ) : (
          <div
            aria-hidden
            style={{
              width: 96,
              height: 96,
              borderRadius: 12,
              border: "1px dashed var(--line)",
              display: "grid",
              placeItems: "center",
              color: "var(--muted, #94a3b8)",
            }}
          >
            <IconImagePlus size={24} />
          </div>
        )}

        <div style={{ display: "grid", gap: 8 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-subtle btn-sm"
              disabled={disabled || busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? <IconSpinner size={16} className="animate-spin" aria-hidden /> : <IconImagePlus size={16} />}
              {busy ? "กำลังอัปโหลด…" : value ? "เปลี่ยนรูป" : "เลือกรูป"}
            </button>

            {value ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={disabled || busy}
                onClick={() => {
                  replaceValue("")
                  setLocalError(null)
                }}
              >
                <IconTrash size={16} />
                ลบรูป
              </button>
            ) : null}

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={disabled || busy}
              onClick={() => setLinkMode((prev) => !prev)}
            >
              {linkMode ? "ซ่อนช่องลิงก์" : "วางลิงก์รูปแทน"}
            </button>
          </div>

          {linkMode ? (
            <input
              className="input"
              maxLength={500}
              placeholder="https://…"
              value={value}
              disabled={disabled || busy}
              onChange={(e) => replaceValue(e.target.value)}
            />
          ) : null}

          <span className="t-caption">
            {hint ?? `รองรับ JPG, PNG, WebP — ระบบย่อรูปให้อัตโนมัติก่อนอัปโหลด (ไม่เกิน ${Math.round(MAX_ASSET_BYTES / 1000)} KB)`}
          </span>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        hidden
        onChange={onFile}
        disabled={disabled || busy}
      />

      {shownError ? <span className="field-hint error">{shownError}</span> : null}
    </div>
  )
}
