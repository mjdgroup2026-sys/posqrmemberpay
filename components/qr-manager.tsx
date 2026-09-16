"use client"

import { FULL_ACCESS, type AllowedActions } from "@/lib/types"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  generateQRCode,
  invalidateQRCode,
  reprintQRCode,
  generateMissingQRCodes,
} from "@/app/actions/qr-codes"
import { formatDateTime, formatNumber } from "@/lib/format"
import { IconSpinner } from "@/components/icons"

export type QrCard = {
  tableId: string
  tableCode: string
  qrId: string | null
  token: string | null
  type: "STATIC" | "DYNAMIC" | null
  issuedAt: string | null
  invalidatedCount: number
  url: string | null
  imageDataUrl: string | null
}

export function QrManager({ cards, allowed = FULL_ACCESS }: { cards: QrCard[]; allowed?: AllowedActions }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [type, setType] = useState<"STATIC" | "DYNAMIC">("STATIC")

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

  function generate(tableId: string) {
    const formData = new FormData()
    formData.set("tableId", tableId)
    formData.set("type", type)
    void run(() => generateQRCode(formData))
  }

  function invalidate(qrId: string) {
    const formData = new FormData()
    formData.set("id", qrId)
    void run(() => invalidateQRCode(formData))
  }

  function reprint(qrId: string) {
    const formData = new FormData()
    formData.set("id", qrId)
    void run(() => reprintQRCode(formData))
  }

  const withQr = cards.filter((c) => c.imageDataUrl !== null)
  const missingCount = cards.length - withQr.length

  return (
    <>
      <div className="page-head no-print">
        <div>
          <p className="t-eyebrow">MJD Mobile Order</p>
          <h1 className="t-h1">จัดการ QR Code</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            โต๊ะหนึ่งมี QR ที่ใช้ได้พร้อมกันแค่ใบเดียว — สร้างใบใหม่แล้วใบเก่าจะถูกยกเลิกทันที
          </p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <select
            className="select"
            style={{ width: 190 }}
            value={type}
            onChange={(e) => setType(e.target.value === "DYNAMIC" ? "DYNAMIC" : "STATIC")}
          >
            <option value="STATIC">ประเภทถาวร (STATIC)</option>
            <option value="DYNAMIC">ประเภทชั่วคราว (DYNAMIC)</option>
          </select>
          <button
            type="button"
            className="btn btn-subtle"
            disabled={pending || missingCount === 0 || !allowed.includes("ADD")}
            title={missingCount === 0 ? "ทุกโต๊ะมี QR อยู่แล้ว" : undefined}
            onClick={() => {
              const formData = new FormData()
              formData.set("type", type)
              void run(() => generateMissingQRCodes(formData))
            }}
          >
            สร้างให้โต๊ะที่ยังไม่มี ({missingCount})
          </button>
          <button
            type="button"
            className="btn btn-subtle"
            disabled={withQr.length === 0}
            onClick={() => window.print()}
          >
            พิมพ์ทั้งหมด
          </button>
          {pending ? <IconSpinner size={18} className="animate-spin" aria-hidden /> : null}
        </div>
      </div>

      <p className="t-caption no-print">
        STATIC = แปะถาวรที่โต๊ะ ใช้ซ้ำได้ทุกรอบลูกค้า · DYNAMIC = ถูกยกเลิกอัตโนมัติทันทีที่ปิดบิล
        ต้องพิมพ์ใบใหม่ทุกรอบ
      </p>

      <section
        className="qr-sheet"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}
      >
        {cards.map((card) => (
          <article key={card.tableId} className="card-ui card-pad" style={{ display: "grid", gap: 10 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700 }}>โต๊ะ {card.tableCode}</span>
              {card.type ? (
                <span className={`chip ${card.type === "STATIC" ? "chip-neutral" : "chip-info"}`}>
                  <span className="dot" />
                  {card.type === "STATIC" ? "ถาวร" : "ชั่วคราว"}
                </span>
              ) : (
                <span className="chip chip-danger">
                  <span className="dot" />
                  ยังไม่มี QR
                </span>
              )}
            </div>

            {card.imageDataUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL ที่สร้างสด ไม่ต้องผ่าน next/image */}
                <img
                  src={card.imageDataUrl}
                  alt={`QR Code โต๊ะ ${card.tableCode}`}
                  style={{ width: "100%", borderRadius: 8, background: "#fff" }}
                />
                <span className="t-caption num" style={{ wordBreak: "break-all" }}>
                  {card.url}
                </span>
                <span className="t-caption num no-print">
                  ออกใบเมื่อ {card.issuedAt ? formatDateTime(card.issuedAt) : "—"}
                  {card.invalidatedCount > 0
                    ? ` · เคยยกเลิก ${formatNumber(card.invalidatedCount)} ใบ`
                    : ""}
                </span>
              </>
            ) : (
              <p className="t-body">ยังไม่มี QR ที่ใช้งานได้ — กดสร้างใบใหม่</p>
            )}

            <div className="row no-print" style={{ gap: 6, flexWrap: "wrap" }}>
              {allowed.includes("ADD") ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={pending}
                  onClick={() => generate(card.tableId)}
                >
                  {card.qrId ? "สร้างใบใหม่" : "สร้าง QR"}
                </button>
              ) : null}

              {card.imageDataUrl ? (
                <a
                  className="btn btn-subtle btn-sm"
                  href={card.imageDataUrl}
                  download={`qr-table-${card.tableCode}.png`}
                >
                  ดาวน์โหลด
                </a>
              ) : null}

              {card.qrId ? (
                <>
                  {allowed.includes("EDIT") ? (
                    <button
                      type="button"
                      className="btn btn-subtle btn-sm"
                      disabled={pending}
                      onClick={() => reprint(card.qrId!)}
                    >
                      บันทึกพิมพ์ซ้ำ
                    </button>
                  ) : null}
                  {allowed.includes("DELETE") ? (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={pending}
                      onClick={() => invalidate(card.qrId!)}
                    >
                      ยกเลิกใบนี้
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </article>
        ))}
      </section>
    </>
  )
}
