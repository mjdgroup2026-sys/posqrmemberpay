"use client"

import { IconPrinter } from "@/components/icons"

/// ปุ่มพิมพ์หน้าปัจจุบันด้วยกล่องพิมพ์ของเบราว์เซอร์ — เนื้อหาที่จะออกกระดาษต้องครอบด้วย `.doc-print` (app/globals.css)
export function PrintButton({ label = "พิมพ์" }: { label?: string }) {
  return (
    <button type="button" className="btn btn-subtle no-print" onClick={() => window.print()}>
      <IconPrinter size={17} aria-hidden />
      {label}
    </button>
  )
}
