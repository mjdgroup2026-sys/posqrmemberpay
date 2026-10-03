import { formatBaht } from "@/lib/format"

export type AmountDueLine = { label: string; amount: number; negative?: boolean }

/// กรอบ "ยอดที่ต้องชำระ" ตัวใหญ่บนหน้ารับเงิน — คู่กับ ChangeDuePanel (เจ้าของขอ 2026-10-03)
/// สีแบรนด์ = "ต้องเก็บ" · สีเตือน (ChangeDuePanel) = "ต้องทอน" ให้แยกด้วยตาได้ทันที
/// ใช้ทั้งหน้าต่างรับเงินของจอขายและหน้าปิดบิลโต๊ะ · `lines` = ที่มาของยอด (ไม่ส่ง = ไม่โชว์)
export function AmountDueHero({
  amount,
  label = "ยอดที่ต้องชำระ",
  lines = [],
  caption,
}: {
  amount: number
  label?: string
  lines?: AmountDueLine[]
  caption?: string
}) {
  return (
    <section className="amount-due-hero no-print" aria-label={`${label} ${formatBaht(amount)} บาท`}>
      <span className="amount-due-label">{label}</span>
      <strong className="amount-due-value num">
        <span className="amount-due-currency">฿</span>
        {formatBaht(amount)}
      </strong>
      {lines.length > 0 ? (
        <dl className="amount-due-lines num">
          {lines.map((line) => (
            <div key={line.label}>
              <dt>{line.label}</dt>
              <dd>
                {line.negative ? "−" : ""}฿{formatBaht(line.amount)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {caption ? <span className="amount-due-caption">{caption}</span> : null}
    </section>
  )
}
