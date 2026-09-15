import { redirect } from "next/navigation"
import { requirePlatformAdmin } from "@/lib/session"
import { listPlanVersionsForAdmin } from "@/lib/admin-queries"
import { formatBaht, formatDateTime } from "@/lib/format"
import { PlanVersionForm, RetirePlanButton } from "@/components/plan-version-form"
import { IconShield } from "@/components/icons"

export const metadata = { title: "แพ็กเกจค่าใช้งาน" }

/// แพ็กเกจทุก version (Phase 14b) — active/superseded/เลิกขาย · แก้ราคา = ออก version ใหม่ ไม่แก้แถวเดิม
export default async function AdminPlansPage() {
  try {
    await requirePlatformAdmin()
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    redirect(code === "UNAUTHENTICATED" ? "/login?callbackUrl=%2Fadmin%2Fplans" : "/access-denied?resource=PLATFORM")
  }

  const versions = await listPlanVersionsForAdmin()
  const active = versions.filter((v) => v.isActive)
  const superseded = versions.filter((v) => !v.isActive)

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">แพลตฟอร์ม</p>
          <h1 className="t-h1">
            <IconShield size={22} aria-hidden /> แพ็กเกจค่าใช้งาน
          </h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            ประวัติเรตแบบ append-only — แก้ราคา/เพดานโต๊ะ = ออก version ใหม่ แถวเก่าคงอยู่ให้ตรวจย้อนหลังว่าวันไหนขายเรตไหน
          </p>
        </div>
      </div>

      <section className="card-ui card-pad">
        <h2 className="t-h2" style={{ marginBottom: 12 }}>
          ออก version ใหม่
        </h2>
        <PlanVersionForm />
      </section>

      <section className="card-ui">
        <div className="panel-head">
          <h2 className="t-h2">
            ขายอยู่ <span className="num">{active.length}</span> แพ็กเกจ
          </h2>
        </div>
        <PlanTable rows={active} showRetire />
      </section>

      {superseded.length > 0 ? (
        <section className="card-ui">
          <div className="panel-head">
            <h2 className="t-h2">
              version เก่า / เลิกขาย <span className="num">{superseded.length}</span>
            </h2>
          </div>
          <PlanTable rows={superseded} />
        </section>
      ) : null}
    </>
  )
}

function PlanTable({ rows, showRetire = false }: { rows: Awaited<ReturnType<typeof listPlanVersionsForAdmin>>; showRetire?: boolean }) {
  return (
    <div className="datatable-wrap">
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
            <th style={{ padding: "10px 24px", fontWeight: 500 }}>code</th>
            <th style={{ padding: "10px 12px", fontWeight: 500 }}>ชื่อ</th>
            <th style={{ padding: "10px 12px", fontWeight: 500 }}>tier / โต๊ะ</th>
            <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>วัน</th>
            <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>เรต/วัน</th>
            <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ส่วนลด</th>
            <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ราคาสุทธิ</th>
            <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>ถูกซื้อ</th>
            <th style={{ padding: "10px 12px", fontWeight: 500 }}>ออกเมื่อ</th>
            {showRetire ? <th style={{ padding: "10px 24px", fontWeight: 500, textAlign: "right" }}>จัดการ</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} style={{ borderTop: "1px solid var(--line)" }}>
              <td className="num" style={{ padding: "12px 24px", fontWeight: 600 }}>
                {p.code} <span className="t-caption">v{p.version}</span>
              </td>
              <td style={{ padding: "12px" }}>{p.name}</td>
              <td style={{ padding: "12px" }}>
                {p.tier} · <span className="num">{p.tableLimit}</span> โต๊ะ
              </td>
              <td className="num" style={{ padding: "12px", textAlign: "right" }}>{p.durationDays}</td>
              <td className="num" style={{ padding: "12px", textAlign: "right" }}>{formatBaht(p.ratePerDay)}</td>
              <td className="num" style={{ padding: "12px", textAlign: "right" }}>{p.discountPercent > 0 ? `${p.discountPercent}%` : "—"}</td>
              <td className="num" style={{ padding: "12px", textAlign: "right", fontWeight: 600 }}>{formatBaht(p.price)}</td>
              <td className="num" style={{ padding: "12px", textAlign: "right" }}>{p.usedCount}</td>
              <td className="num t-caption" style={{ padding: "12px" }}>{formatDateTime(p.createdAt)}</td>
              {showRetire ? (
                <td style={{ padding: "12px 24px", textAlign: "right" }}>{p.code !== "TRIAL" ? <RetirePlanButton code={p.code} /> : null}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
