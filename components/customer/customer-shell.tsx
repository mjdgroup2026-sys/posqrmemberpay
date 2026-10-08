import Link from "next/link"
import type { ReactNode } from "react"
import { Copyright } from "@/components/copyright"
import { placeLabel, type PlaceKind } from "@/lib/order-label"

/// โครงหน้าฝั่งลูกค้า — หัวเรื่องร้าน/โต๊ะ + พื้นที่เนื้อหา (มือถือเป็นหลัก กว้างสุด 480px)
export function CustomerShell({
  storeName,
  tableCode,
  tableKind = null,
  backHref,
  title,
  children,
  footer,
}: {
  storeName: string
  tableCode: string
  /// ห้องนวดขึ้น "ห้อง" แทน "โต๊ะ" (2026-10-08) — ลูกค้าสแกน QR ในห้องนวด
  tableKind?: PlaceKind | null
  backHref?: string
  title?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: "var(--surface-2)" }}>
      <header
        style={{
          background: "var(--surface)",
          borderBottom: "1px solid var(--line)",
          padding: "14px 16px",
          position: "sticky",
          top: 0,
          zIndex: 5,
        }}
      >
        <div style={{ maxWidth: 480, margin: "0 auto", display: "flex", alignItems: "center", gap: 12 }}>
          {backHref ? (
            <Link href={backHref} className="t-small" aria-label="ย้อนกลับ">
              ‹ กลับ
            </Link>
          ) : null}
          <div style={{ minWidth: 0 }}>
            <p style={{ fontWeight: 700 }}>{title ?? storeName}</p>
            <p className="t-caption">{placeLabel(tableKind, tableCode)}</p>
          </div>
        </div>
      </header>

      <main style={{ flex: 1, width: "100%", maxWidth: 480, margin: "0 auto", padding: "16px 16px 96px" }}>
        {children}
        <Copyright className="customer-copyright" />
      </main>

      {footer ? (
        <div
          style={{
            position: "sticky",
            bottom: 0,
            background: "var(--surface)",
            borderTop: "1px solid var(--line)",
            padding: "12px 16px",
          }}
        >
          <div style={{ maxWidth: 480, margin: "0 auto" }}>{footer}</div>
        </div>
      ) : null}
    </div>
  )
}

/// การ์ดข้อความเมื่อ token ใช้ไม่ได้ — ลูกค้าเห็นสิ่งที่ต้องทำต่อเสมอ ไม่ใช่หน้า error เปล่า
export function CustomerNotice({ title, description }: { title: string; description: string }) {
  return (
    <main style={{ padding: 24, display: "grid", placeItems: "center", minHeight: "100dvh" }}>
      <div className="card-ui card-pad" style={{ textAlign: "center", maxWidth: 360 }}>
        <h1 className="t-h2">{title}</h1>
        <p className="t-body" style={{ marginTop: 10 }}>
          {description}
        </p>
      </div>
      <Copyright />
    </main>
  )
}
