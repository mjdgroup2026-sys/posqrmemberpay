import Link from "next/link"
import { formatBaht } from "@/lib/format"
import { IconWallet } from "@/components/icons"

/// แผงเงินทอนหลังรับเงินสด — ค้างอยู่ในหน้าจ่ายเงินจนพนักงานกด "ทอนเงินแล้ว" (เจ้าของขอ 2026-10-03)
/// ใช้ทั้งจอขาย (กลับบ้าน · `onDone`) และหน้าปิดบิลโต๊ะ (server component · `href`) · ไม่พิมพ์ลงใบเสร็จ (`no-print`)
type Props = {
  total: number
  received: number
  changeDue: number
  actionLabel: string
} & ({ onDone: () => void; href?: never } | { href: string; onDone?: never })

export function ChangeDuePanel({ total, received, changeDue, actionLabel, onDone, href }: Props) {
  return (
    <section className="change-due-panel no-print" role="status" aria-live="assertive">
      <span className="t-eyebrow">
        <IconWallet size={15} aria-hidden /> ต้องทอนเงินลูกค้า
      </span>
      <strong className="change-due-amount num">฿{formatBaht(changeDue)}</strong>
      <dl className="change-due-breakdown num">
        <div>
          <dt>ยอดที่ต้องชำระ</dt>
          <dd>฿{formatBaht(total)}</dd>
        </div>
        <div>
          <dt>รับเงินมา</dt>
          <dd>฿{formatBaht(received)}</dd>
        </div>
      </dl>
      {href ? (
        <Link href={href} className="btn btn-primary btn-lg btn-block">
          {actionLabel}
        </Link>
      ) : (
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={onDone}>
          {actionLabel}
        </button>
      )}
    </section>
  )
}
