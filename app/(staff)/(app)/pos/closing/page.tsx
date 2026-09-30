import Link from "next/link"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/session"
import { getDayClosings, getOpenSalesSummary, getStoreDaySummary, listClosings, type ClosingChannelLine, type ClosingView } from "@/lib/queries"
import { CLOSING_CHANNELS, CLOSING_CHANNEL_LABEL } from "@/lib/closing-channels"
import { formatBaht, formatBusinessDate, formatDate, formatDateTime, formatNumber } from "@/lib/format"
import { businessDayKey, parseBusinessDayKey } from "@/lib/day"
import { ClosingDatePicker } from "@/components/closing-date-picker"
import { ClosingForm } from "@/components/closing-form"
import { ReopenClosingButton } from "@/components/reopen-closing-button"
import { requirePageAccess } from "@/lib/permissions"

export const metadata = { title: "ปิดยอดประจำวัน" }

export default async function ClosingPage({ searchParams }: PageProps<"/pos/closing">) {
  // ด่านชั้นที่ 1 ของ §4 — ต้องมีสิทธิ์ VIEW ก่อนถึงจะ render ได้
  const { storeId, granted } = await requirePageAccess("POS_CLOSING")
  const canClose = granted.POS_CLOSING?.includes("ADD") ?? false
  // เปิดรอบที่ปิดแล้วใหม่ (2026-09-30) — ด่านจริงอยู่ที่ reopenCashierClosing
  const canReopen = granted.POS_CLOSING?.includes("EDIT") ?? false

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
  // ปิดหลายรอบต่อวัน (2026-09-29): summary = บิลที่ยังไม่ถูกปิดรอบ · rounds = รอบที่ปิดแล้วของวันนั้น
  const [summary, rounds, history, storeDay] = await Promise.all([
    getOpenSalesSummary(storeId, cashierId, closingDay),
    getDayClosings(storeId, cashierId, closingDay),
    listClosings(storeId, { cashierId, limit: 30 }),
    canSeeStore ? getStoreDaySummary(storeId, closingDay) : Promise.resolve(null),
  ])

  // รอบที่ถูกเปิดใหม่ (2026-09-30) ยังแสดงเป็นประวัติ แต่ไม่นับยอด — บิลของมันกลับไปอยู่ใน summary แล้ว
  const active = rounds.filter((round) => round.reopened === null)
  const lastRound = active.at(-1) ?? null
  // เลขรอบนับต่อจากรอบสูงสุด รวมรอบที่ถูกเปิดใหม่ (ตรงกับ action)
  const nextRound = (rounds.at(-1)?.roundNo ?? 0) + 1
  const openBills = summary.billCount + summary.voidedCount
  const dayTotal = active.reduce((sum, round) => sum + round.totalSales, 0) + summary.totalSales
  // จำนวนบิลทั้งวันของคนนี้ (บิลสำเร็จ · ยกเลิก) = รอบที่ใช้อยู่ + ที่ยังไม่ปิดรอบ
  const dayBills = active.reduce((sum, round) => sum + round.billCount, 0) + summary.billCount
  const dayVoided = active.reduce((sum, round) => sum + round.voidedCount, 0) + summary.voidedCount
  // ยังไม่มีรอบที่ใช้อยู่ = ปิดได้เสมอ (แม้ไม่มีบิล เหมือนเดิม) · มีแล้ว = ต้องมีบิลใหม่ก่อน
  const canCloseNext = active.length === 0 || openBills > 0
  // รอบล่าสุดของวันเพิ่งถูกเปิดใหม่ = ใส่ยอดที่เคยนับไว้ให้ในฟอร์ม
  const latest = rounds.at(-1)
  const initialCounted = latest?.reopened
    ? Object.fromEntries(latest.channels.map((line) => [line.channel, line.counted]))
    : undefined

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
          <span className="t-caption">
            {active.length > 0 ? "ยอดที่ยังไม่ปิดรอบ" : isToday ? "ยอดขายรวมวันนี้" : "ยอดขายรวมของวันที่เลือก"}
          </span>
          <strong className="t-h1 num">฿{formatBaht(summary.totalSales)}</strong>
          <span className="t-caption num">
            {formatNumber(summary.billCount)} บิล
            {active.length > 0
              ? ` · ทั้งวัน ฿${formatBaht(dayTotal)} · ${formatNumber(dayBills)} บิล (ปิดแล้ว ${active.length} รอบ)`
              : ""}
          </span>
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
          <span className="t-caption">
            {active.length > 0 ? "บิลที่ถูกยกเลิก (ยังไม่ปิดรอบ)" : isToday ? "บิลที่ถูกยกเลิกวันนี้" : "บิลที่ถูกยกเลิกในวันนั้น"}
          </span>
          <strong className="t-h1 num" style={{ color: summary.voidedCount > 0 ? "var(--danger)" : undefined }}>
            {formatNumber(summary.voidedCount)}
          </strong>
          {active.length > 0 ? <span className="t-caption num">ทั้งวัน {formatNumber(dayVoided)} บิล</span> : null}
        </article>
      </section>

      <div className="form-split">
        <section className="card-ui card-pad" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {rounds.map((round) => (
            <RoundResult
              key={round.id}
              round={round}
              reopenable={canReopen && round.id === lastRound?.id}
            />
          ))}

          {active.length > 0 && openBills > 0 ? (
            <div className="alert-banner warning">
              ขายหลังปิดรอบที่ {lastRound?.roundNo} แล้ว <span className="num">{formatNumber(openBills)}</span> บิล · ฿
              <span className="num">{formatBaht(summary.totalSales)}</span> — ยังไม่ได้ปิด นับเงินแล้วปิดเป็นรอบที่ {nextRound}
            </div>
          ) : null}

          {canCloseNext ? (
            <div>
              <h2 className="t-h2" style={{ marginBottom: 16 }}>
                {nextRound === 1 ? "นับเงินและปิดยอด" : `นับเงินและปิดรอบที่ ${nextRound}`}
              </h2>
              {canClose ? (
                <ClosingForm
                  // key เปลี่ยนตามรอบ — เปิดรอบใหม่แล้ว refresh ฟอร์มต้องรับยอดเดิมชุดใหม่ ไม่ค้าง state เก่า
                  key={`${closingKey}-${nextRound}`}
                  summary={summary}
                  closingDate={closingKey}
                  isToday={isToday}
                  roundNo={nextRound}
                  initialCounted={initialCounted}
                />
              ) : (
                <div className="alert-banner info">คุณมีสิทธิ์ดูยอดขายอย่างเดียว — บันทึกรายการไม่ได้ (ติดต่อเจ้าของร้านเพื่อขอสิทธิ์)</div>
              )}
            </div>
          ) : (
            <p className="t-caption">
              ปิดครบทุกบิลของ{isToday ? "วันนี้" : "วันที่เลือก"}แล้ว — ถ้ามีขายเพิ่ม กลับมาปิดเป็นรอบที่ {nextRound} ได้ที่หน้านี้
            </p>
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
                  {groupByDay(history).map((day) => [
                    ...day.rows.map((row) => (
                    <tr
                      key={row.id}
                      style={{ borderTop: "1px solid var(--line)", opacity: row.reopened ? 0.55 : 1 }}
                      title={row.reopened ? `เปิดใหม่โดย ${row.reopened.byName} · ${row.reopened.reason}` : undefined}
                    >
                      <td className="num" style={{ padding: "12px 24px" }}>
                        <Link href={`/pos/closing?date=${row.closingDate.toISOString().slice(0, 10)}`} style={{ textDecoration: "underline" }}>
                          {formatDate(row.closingDate)}
                        </Link>
                        <span className="t-caption"> · รอบ {row.roundNo}</span>
                        {row.reopened ? (
                          <>
                            <br />
                            <span className="chip chip-warning">
                              <span className="dot" />
                              เปิดใหม่แล้ว
                            </span>
                          </>
                        ) : null}
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
                    )),
                    // สรุปรายวัน (2026-09-30) — นับเฉพาะรอบที่ยังใช้อยู่ · แสดงเมื่อวันนั้นมีมากกว่า 1 แถว
                    day.rows.length > 1 ? (
                      <tr key={`${day.key}-total`} style={{ background: "var(--surface-2)" }}>
                        <td className="t-caption" style={{ padding: "8px 24px" }}>
                          รวมวันที่ {formatDate(day.rows[0].closingDate)} · {formatNumber(day.activeRounds)} รอบ
                        </td>
                        <td className="num" style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700 }}>
                          ฿{formatBaht(day.totalSales)}
                        </td>
                        <td colSpan={4} />
                        <td className="num" style={{ padding: "8px 24px", textAlign: "right", fontWeight: 700 }}>
                          {formatNumber(day.billCount)} / ยกเลิก {formatNumber(day.voidedCount)}
                        </td>
                      </tr>
                    ) : null,
                  ])}
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
                        {row.rounds === null ? (
                          <span className="t-caption">ไม่มีรอบ (อัตโนมัติ)</span>
                        ) : row.openBills > 0 ? (
                          <span className="chip chip-warning">
                            <span className="dot" />
                            {row.rounds > 0 ? `ปิด ${row.rounds} รอบ · ค้าง ${row.openBills} บิล` : "ยังไม่ปิดรอบ"}
                          </span>
                        ) : (
                          <span className="chip chip-success">
                            <span className="dot" />
                            ปิดแล้ว {row.rounds} รอบ
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

/// ผลของรอบที่ปิดแล้ว — ตารางยอดในระบบ/ตรวจได้/ส่วนต่างต่อช่องทาง (แก้ไขไม่ได้)
/// รอบที่ถูกเปิดใหม่ (2026-09-30) แสดงจางพร้อมคนเปิด/เวลา/เหตุผล · `reopenable` = แสดงปุ่มเปิดรอบใหม่ (มีสิทธิ์ + เป็นรอบล่าสุด)
function RoundResult({ round, reopenable }: { round: ClosingView; reopenable: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: round.reopened ? 0.6 : 1 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h2 className="t-h2">รอบที่ {round.roundNo}</h2>
        <span className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {round.reopened ? (
            <span className="chip chip-warning">
              <span className="dot" />
              เปิดใหม่แล้ว — ไม่นับยอด
            </span>
          ) : (
            <span className="chip chip-success">
              <span className="dot" />
              ปิดเมื่อ {formatDateTime(round.closedAt)}
            </span>
          )}
          {reopenable ? <ReopenClosingButton closingId={round.id} roundNo={round.roundNo} /> : null}
        </span>
      </div>
      {round.reopened ? (
        <p className="t-caption">
          เปิดใหม่โดย {round.reopened.byName} เมื่อ {formatDateTime(round.reopened.at)} · เหตุผล: {round.reopened.reason}
        </p>
      ) : null}
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
            {round.channels.map((line) => (
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
              <td style={{ padding: "8px 10px", fontWeight: 600 }}>
                รวม{" "}
                <span className="t-caption num">
                  · {formatNumber(round.billCount)} บิล / ยกเลิก {formatNumber(round.voidedCount)}
                </span>
              </td>
              <td className="num" style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700 }}>฿{formatBaht(round.totalSales)}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
      {round.note ? <p className="t-caption">หมายเหตุ: {round.note}</p> : null}
    </div>
  )
}

/// จัดประวัติเป็นกลุ่มรายวัน + ยอดรวมของวัน (2026-09-30) — รวมเฉพาะรอบที่ยังใช้อยู่ (รอบที่ถูกเปิดใหม่ไม่นับ)
/// history มาเรียงวันใหม่ → เก่าแล้ว จึงจัดกลุ่มตามลำดับที่มาได้เลย
function groupByDay<T extends ClosingView>(rows: T[]) {
  const days: { key: string; rows: T[]; activeRounds: number; totalSales: number; billCount: number; voidedCount: number }[] = []
  for (const row of rows) {
    const key = row.closingDate.toISOString().slice(0, 10)
    let day = days.at(-1)
    if (day?.key !== key) {
      day = { key, rows: [], activeRounds: 0, totalSales: 0, billCount: 0, voidedCount: 0 }
      days.push(day)
    }
    day.rows.push(row)
    if (row.reopened) continue
    day.activeRounds += 1
    day.totalSales += row.totalSales
    day.billCount += row.billCount
    day.voidedCount += row.voidedCount
  }
  return days
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
