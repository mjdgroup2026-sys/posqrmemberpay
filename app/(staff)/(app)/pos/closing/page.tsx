import Link from "next/link"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/session"
import { getStoreDaySummary, getTodaySalesSummary, getTodayClosing, listClosings, type ClosingChannelLine } from "@/lib/queries"
import { CLOSING_CHANNELS, CLOSING_CHANNEL_LABEL } from "@/lib/closing-channels"
import { formatBaht, formatBusinessDate, formatDate, formatDateTime, formatNumber } from "@/lib/format"
import { businessDayKey, parseBusinessDayKey } from "@/lib/day"
import { ClosingDatePicker } from "@/components/closing-date-picker"
import { ClosingForm } from "@/components/closing-form"
import { requirePageAccess } from "@/lib/permissions"

export const metadata = { title: "ปิดยอดประจำวัน" }

export default async function ClosingPage({ searchParams }: PageProps<"/pos/closing">) {
  // ด่านชั้นที่ 1 ของ §4 — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId, granted } = await requirePageAccess("POS_CLOSING")
  const canClose = granted.POS_CLOSING?.includes("ADD") ?? false

  const session = await getSession()
  if (!session?.user) redirect("/login")

  const cashierId = session.user.id

  // Phase 19 — เลือกวันปิดรอบผ่าน ?date=YYYY-MM-DD (ย้อนหลังเท่านั้น) · ค่าที่ผิด/อนาคต = ถอยกลับเป็นวันนี้เงียบ ๆ
  const query = await searchParams
  const todayKey = businessDayKey()
  const requestedKey = typeof query.date === "string" ? query.date : todayKey
  const closingDay = parseBusinessDayKey(requestedKey) ?? parseBusinessDayKey(todayKey)
  if (!closingDay) redirect("/pos/closing")
  const closingKey = businessDayKey(closingDay)
  const isToday = closingKey === todayKey
  // สรุปทั้งร้าน (20g) — เฉพาะคนที่ดูรายงานได้ (เจ้าของได้เสมอ) เพราะเห็นยอดของแคชเชียร์ทุกคน
  const canSeeStore = granted.REPORTS?.includes("VIEW") ?? false
  const [summary, today, history, storeDay] = await Promise.all([
    getTodaySalesSummary(storeId, cashierId, closingDay),
    getTodayClosing(storeId, cashierId, closingDay),
    listClosings(storeId, { cashierId, limit: 30 }),
    canSeeStore ? getStoreDaySummary(storeId, closingDay) : Promise.resolve(null),
  ])

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">ขายหน้าร้าน</p>
          <h1 className="t-h1">ปิดยอดประจำวัน</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            สรุปยอดของ {session.user.name} รอบวันที่ <strong>{formatBusinessDate(closingDay)}</strong>
            {isToday ? " (วันนี้)" : " (ย้อนหลัง)"} — คำนวณอัตโนมัติจากบิลจริง ไม่ต้องกรอกเอง
          </p>
        </div>
        <ClosingDatePicker value={closingKey} today={todayKey} />
      </div>

      <section
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}
      >
        <article className="stat-tile">
          <span className="t-caption">{isToday ? "ยอดขายรวมวันนี้" : "ยอดขายรวมของวันที่เลือก"}</span>
          <strong className="t-h1 num">฿{formatBaht(summary.totalSales)}</strong>
          <span className="t-caption num">{formatNumber(summary.billCount)} บิล</span>
        </article>
        <article className="stat-tile">
          <span className="t-caption">เงินสด</span>
          <strong className="t-h1 num">฿{formatBaht(summary.totalCash)}</strong>
          <span className="t-caption">ยอดที่ต้องมีในลิ้นชัก</span>
        </article>
        {/* 20g — แยกครบทุกช่องทาง (พร้อมเพย์แยกจากบัตรแล้ว) เทียบกับแอปธนาคาร/สลิป EDC ได้ทีละช่อง */}
        {(
          [
            ["โอนเงิน", summary.totalTransfer],
            ["QR หน้าร้าน", summary.totalQR],
            ["พร้อมเพย์", summary.totalPromptPay],
            ["บัตร (EDC)", summary.totalCard],
          ] as const
        ).map(([label, value]) => (
          <article key={label} className="stat-tile" style={{ opacity: value === 0 ? 0.6 : 1 }}>
            <span className="t-caption">{label}</span>
            <strong className="t-h1 num">฿{formatBaht(value)}</strong>
          </article>
        ))}
        <article className="stat-tile">
          <span className="t-caption">{isToday ? "บิลที่ถูกยกเลิกวันนี้" : "บิลที่ถูกยกเลิกในวันนั้น"}</span>
          <strong className="t-h1 num" style={{ color: summary.voidedCount > 0 ? "var(--danger)" : undefined }}>
            {formatNumber(summary.voidedCount)}
          </strong>
        </article>
      </section>

      <div className="form-split">
        <section className="card-ui card-pad">
          <h2 className="t-h2" style={{ marginBottom: 16 }}>
            {today ? (isToday ? "ผลการปิดยอดวันนี้" : "ผลการปิดยอดของวันที่เลือก") : "นับเงินและปิดยอด"}
          </h2>

          {today ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="alert-banner info">
                ปิดยอดรอบวันที่ {formatBusinessDate(closingDay)} เรียบร้อยแล้วเมื่อ {formatDateTime(today.closedAt)} — แก้ไขไม่ได้
              </div>
              <div className="datatable-wrap">
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                      <th style={{ padding: "8px 10px", fontWeight: 500 }}>ช่องทาง</th>
                      <th style={{ padding: "8px 10px", fontWeight: 500, textAlign: "right" }}>ยอดในระบบ</th>
                      <th style={{ padding: "8px 10px", fontWeight: 500, textAlign: "right" }}>ตรวจได้</th>
                      <th style={{ padding: "8px 10px", fontWeight: 500, textAlign: "right" }}>ส่วนต่าง</th>
                    </tr>
                  </thead>
                  <tbody>
                    {today.channels.map((line) => (
                      <tr key={line.channel} style={{ borderTop: "1px solid var(--line)" }}>
                        <td style={{ padding: "8px 10px" }}>{CLOSING_CHANNEL_LABEL[line.channel]}</td>
                        <td className="num" style={{ padding: "8px 10px", textAlign: "right" }}>฿{formatBaht(line.total)}</td>
                        <td className="num" style={{ padding: "8px 10px", textAlign: "right" }}>
                          {line.counted === null ? <span className="t-caption">ไม่ได้ตรวจ</span> : `฿${formatBaht(line.counted)}`}
                        </td>
                        <td className="num" style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: diffColor(line.difference) }}>
                          {line.difference === null ? "—" : `${line.difference > 0 ? "+" : ""}${formatBaht(line.difference)}`}
                        </td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: "2px solid var(--line)", background: "var(--surface-2)" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 600 }}>รวม</td>
                      <td className="num" style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700 }}>฿{formatBaht(today.totalSales)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tbody>
                </table>
              </div>
              {today.note ? <p className="t-caption">หมายเหตุ: {today.note}</p> : null}
            </div>
          ) : canClose ? (
            <ClosingForm summary={summary} closingDate={closingKey} isToday={isToday} />
          ) : (
            <div className="alert-banner info">คุณมีสิทธิ์ดูยอดขายอย่างเดียว — บันทึกรายการไม่ได้ (ติดต่อเจ้าของร้านเพื่อขอสิทธิ์)</div>
          )}
        </section>

        <section className="card-ui">
          <div className="panel-head">
            <h2 className="t-h2">ประวัติการปิดยอด</h2>
          </div>
          {history.length === 0 ? (
            <p className="t-body" style={{ padding: 24 }}>
              ยังไม่มีประวัติการปิดยอด
            </p>
          ) : (
            <div className="datatable-wrap">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                    <th style={{ padding: "10px 24px", fontWeight: 500 }}>วันที่</th>
                    <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ยอดขาย</th>
                    <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>เงินสดระบบ</th>
                    <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>นับได้</th>
                    <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ส่วนต่าง</th>
                    <th style={{ padding: "10px 12px", fontWeight: 500 }}>ช่องทางอื่น</th>
                    <th style={{ padding: "10px 24px", fontWeight: 500, textAlign: "right" }}>บิล</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id} style={{ borderTop: "1px solid var(--line)" }}>
                      <td className="num" style={{ padding: "12px 24px" }}>
                        <Link href={`/pos/closing?date=${row.closingDate.toISOString().slice(0, 10)}`} style={{ textDecoration: "underline" }}>
                          {formatDate(row.closingDate)}
                        </Link>
                      </td>
                      <td className="num" style={{ padding: "12px", textAlign: "right" }}>
                        ฿{formatBaht(row.totalSales)}
                      </td>
                      <td className="num" style={{ padding: "12px", textAlign: "right" }}>
                        ฿{formatBaht(row.totalCash)}
                      </td>
                      <td className="num" style={{ padding: "12px", textAlign: "right" }}>
                        ฿{formatBaht(row.countedCash)}
                      </td>
                      <td
                        className="num"
                        style={{
                          padding: "12px",
                          textAlign: "right",
                          fontWeight: 600,
                          color:
                            row.difference === 0
                              ? undefined
                              : row.difference > 0
                                ? "var(--info)"
                                : "var(--danger)",
                        }}
                      >
                        {row.difference > 0 ? "+" : ""}
                        {formatBaht(row.difference)}
                      </td>
                      <td className="t-caption" style={{ padding: "12px" }}>
                        {otherChannelsVerdict(row.channels)}
                      </td>
                      <td className="num t-caption" style={{ padding: "12px 24px", textAlign: "right" }}>
                        {formatNumber(row.billCount)} / ยกเลิก {formatNumber(row.voidedCount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* สรุปทั้งร้านรายวัน (20g) — รวมทุกแคชเชียร์ + บิลที่ธนาคารปิดเอง (ไม่อยู่ในรอบของใคร)
          ไว้เทียบกับยอดเข้าบัญชีทั้งวัน · อ่านอย่างเดียว · เห็นเฉพาะคนที่ดูรายงานได้ */}
      {storeDay ? (
        <section className="card-ui">
          <div className="panel-head">
            <h2 className="t-h2">สรุปทั้งร้าน · {formatBusinessDate(closingDay)}</h2>
            <span className="t-caption num">
              ฿{formatBaht(storeDay.totalSales)} · {formatNumber(storeDay.billCount)} บิล
            </span>
          </div>
          {storeDay.byCashier.length === 0 ? (
            <p className="t-body" style={{ padding: 24 }}>ยังไม่มีบิลในวันนี้</p>
          ) : (
            <div className="datatable-wrap">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
                <thead>
                  <tr style={{ textAlign: "right", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                    <th style={{ padding: "10px 24px", fontWeight: 500, textAlign: "left" }}>คนปิดบิล</th>
                    {CLOSING_CHANNELS.map((channel) => (
                      <th key={channel} style={{ padding: "10px 12px", fontWeight: 500 }}>
                        {CLOSING_CHANNEL_LABEL[channel]}
                      </th>
                    ))}
                    <th style={{ padding: "10px 12px", fontWeight: 600 }}>รวม</th>
                    <th style={{ padding: "10px 24px", fontWeight: 500, textAlign: "left" }}>รอบ</th>
                  </tr>
                </thead>
                <tbody>
                  {storeDay.byCashier.map((row) => (
                    <tr key={row.cashierId} style={{ borderTop: "1px solid var(--line)", textAlign: "right" }}>
                      <td style={{ padding: "10px 24px", textAlign: "left" }}>
                        {row.name}
                        <br />
                        <span className="t-caption num">{formatNumber(row.billCount)} บิล</span>
                      </td>
                      {CLOSING_CHANNELS.map((channel) => (
                        <td key={channel} className="num" style={{ padding: "10px 12px" }}>
                          {row.totals[channel] === 0 ? <span className="t-caption">—</span> : formatBaht(row.totals[channel])}
                        </td>
                      ))}
                      <td className="num" style={{ padding: "10px 12px", fontWeight: 600 }}>{formatBaht(row.totalSales)}</td>
                      <td style={{ padding: "10px 24px", textAlign: "left" }}>
                        {row.closed === null ? (
                          <span className="t-caption">ไม่มีรอบ (อัตโนมัติ)</span>
                        ) : row.closed ? (
                          <span className="chip chip-success">
                            <span className="dot" />
                            ปิดรอบแล้ว
                          </span>
                        ) : (
                          <span className="chip chip-warning">
                            <span className="dot" />
                            ยังไม่ปิดรอบ
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "2px solid var(--line)", background: "var(--surface-2)", textAlign: "right" }}>
                    <td style={{ padding: "10px 24px", textAlign: "left", fontWeight: 600 }}>รวมทั้งร้าน</td>
                    {CLOSING_CHANNELS.map((channel) => (
                      <td key={channel} className="num" style={{ padding: "10px 12px", fontWeight: 700 }}>
                        {formatBaht(storeDay.totals[channel])}
                      </td>
                    ))}
                    <td className="num" style={{ padding: "10px 12px", fontWeight: 700 }}>{formatBaht(storeDay.totalSales)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </>
  )
}

/// สีส่วนต่าง: เกิน = น้ำเงิน · ขาด = แดง · ตรง/ไม่ได้ตรวจ = สีปกติ (ตรงกับป้ายในฟอร์มปิดรอบ — เขียวสงวนไว้ให้ "ตรงพอดี")
function diffColor(difference: number | null): string | undefined {
  if (difference === null || difference === 0) return undefined
  return difference > 0 ? "var(--info)" : "var(--danger)"
}

/// สรุปช่องทางที่ไม่ใช่เงินสดของรอบหนึ่งในบรรทัดเดียว (ประวัติ)
function otherChannelsVerdict(channels: ClosingChannelLine[]): string {
  const checked = channels.filter((line) => line.channel !== "CASH" && line.difference !== null)
  if (checked.length === 0) return "ไม่ได้ตรวจ"
  const off = checked.filter((line) => line.difference !== 0)
  return off.length === 0
    ? `ตรงทั้งหมด (${checked.length} ช่อง)`
    : `ไม่ตรง: ${off.map((line) => `${CLOSING_CHANNEL_LABEL[line.channel]} ${line.difference! > 0 ? "+" : ""}${formatBaht(line.difference!)}`).join(" · ")}`
}
