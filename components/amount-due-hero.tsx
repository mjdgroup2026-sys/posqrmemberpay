import { formatBaht } from "@/lib/format"

export type AmountDueLine = { label: string; amount: number; negative?: boolean; struck?: boolean }

/// กรอบยอดที่ต้องชำระตัวใหญ่บนหน้ารับเงิน — คู่กับ ChangeDuePanel (เจ้าของขอ 2026-10-03)
/// สีแบรนด์ = "ต้องเก็บ" · สีเตือน (ChangeDuePanel) = "ต้องทอน" ให้แยกด้วยตาได้ทันที
///
/// อ่านจากบนลงล่างแบบใบเสร็จ: `lines` (ที่มาของยอด เช่น ยอดรวม / ส่วนลด) → เส้นคั่น → ยอดสุทธิตัวใหญ่ด้านล่าง
/// ไม่มี `lines` = โชว์แค่ยอดตัวใหญ่ · ใช้ทั้งหน้าต่างรับเงินของจอขายและหน้าปิดบิลโต๊ะ
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
      {lines.length > 0 ? (
        <dl className="amount-due-lines num">
          {lines.map((line) => (
            <div key={line.label} className={line.negative ? "is-negative" : undefined}>
              <dt>{line.label}</dt>
              <dd className={line.struck ? "is-struck" : undefined}>
                {line.negative ? "−" : ""}฿{formatBaht(line.amount)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="amount-due-total">
        <span className="amount-due-label">{label}</span>
        <strong className="amount-due-value num">
          <span className="amount-due-currency">฿</span>
          {formatBaht(amount)}
        </strong>
      </div>
      {caption ? <span className="amount-due-caption">{caption}</span> : null}
    </section>
  )
}
