import Link from "next/link"
import { redirect } from "next/navigation"
import { getSession, resolveStoreContext } from "@/lib/session"
import { getBrandOverview } from "@/lib/brand-queries"
import { remainingDays, TIER_SPEC } from "@/lib/subscription"
import { formatBaht, formatDate } from "@/lib/format"
import { AttachStoreForm, CopyMenuForm, CreateBrandForm, RenameBrandForm } from "@/components/brand-manager"
import { IconBrand, IconCard, IconPlus, IconReports } from "@/components/icons"

export const metadata = { title: "แบรนด์" }

/// ร้านหลายสาขา (Phase 14c) — หน้าเดียวของเจ้าของแบรนด์: สร้าง/เปลี่ยนชื่อแบรนด์ ดึงสาขาเข้า คัดลอกเมนู
/// และทางไปรายงานรวม/ใบจ่ายรวม · ไม่ต้องมีร้านที่ทำงานอยู่ก็เข้าได้ (คนที่เพิ่งสร้างแบรนด์แต่ยังไม่มีร้าน)
export default async function BrandPage() {
  const result = await resolveStoreContext()
  if (!result.ok && result.reason === "UNAUTHENTICATED") redirect("/login?callbackUrl=%2Fbrand")
  const ctx = result.ok ? result.context : null
  const memberships = result.ok ? result.context.memberships : result.memberships
  // resolveStoreContext ไม่คืน user เมื่อยังไม่มีร้าน → อ่านจาก session ตรง (คนที่สร้างแบรนด์ก่อนมีร้านก็เข้าได้)
  const userId = ctx?.user.id ?? (await getSession())?.user?.id ?? null
  if (!userId) redirect("/login?callbackUrl=%2Fbrand")

  const overview = await getBrandOverview(userId)
  const now = new Date()

  // สาขาต้นทางที่คัดลอกเมนูได้ = ทุกร้านที่เป็น OWNER ยกเว้นร้านที่ทำงานอยู่
  const copySources = ctx
    ? memberships.filter((m) => m.role === "OWNER" && m.storeId !== ctx.storeId).map((m) => ({ id: m.storeId, name: m.name, slug: m.slug }))
    : []

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">ร้านหลายสาขา</p>
          <h1 className="t-h1">
            <IconBrand size={22} aria-hidden /> {overview.brand ? overview.brand.name : "แบรนด์"}
          </h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            แบรนด์ครอบหลายสาขาเพื่อลดงานซ้ำของเจ้าของ — เมนู โต๊ะ QR รายงาน และแพ็กเกจยังแยกรายสาขา
            {" · "}คุณเป็นเจ้าของทุกสาขาใต้แบรนด์โดยอัตโนมัติ สลับสาขาได้จากแถบด้านบน
          </p>
        </div>
        {overview.brand ? (
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Link href="/brand/reports" className="btn btn-subtle">
              <IconReports size={16} aria-hidden />
              รายงานรวม
            </Link>
            <Link href="/brand/billing" className="btn btn-primary">
              <IconCard size={16} aria-hidden />
              จ่ายค่าใช้งานรวม
            </Link>
          </div>
        ) : null}
      </div>

      {!overview.brand ? (
        <CreateBrandForm attachable={overview.attachable} />
      ) : (
        <>
          <section className="card-ui card-pad">
            <div className="row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h2 className="t-h2">สาขาใต้แบรนด์ ({overview.stores.length})</h2>
                <p className="t-caption" style={{ marginTop: 4 }}>
                  สร้างเมื่อ {formatDate(overview.brand.createdAt)}
                </p>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <RenameBrandForm name={overview.brand.name} />
                <Link href="/onboarding?brand=1" className="btn btn-primary btn-sm">
                  <IconPlus size={14} aria-hidden />
                  สร้างสาขาใหม่
                </Link>
              </div>
            </div>

            {overview.stores.length === 0 ? (
              <p className="t-body" style={{ marginTop: 12 }}>
                ยังไม่มีสาขาใต้แบรนด์ — ดึงร้านที่มีอยู่เข้ามา หรือสร้างสาขาใหม่
              </p>
            ) : (
              <div className="datatable-wrap" style={{ marginTop: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9375rem" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--ink-3)", background: "var(--surface-2)" }}>
                      <th style={{ padding: "10px 12px", fontWeight: 500 }}>สาขา</th>
                      <th style={{ padding: "10px 12px", fontWeight: 500 }}>สถานะ</th>
                      <th style={{ padding: "10px 12px", fontWeight: 500 }}>แพ็กเกจ</th>
                      <th style={{ padding: "10px 12px", fontWeight: 500, textAlign: "right" }}>โต๊ะ/เพดาน</th>
                      <th style={{ padding: "10px 12px", fontWeight: 500 }}>ค่าใช้งาน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.stores.map((s) => {
                      const daysLeft = remainingDays(now, s.planExpiresAt)
                      const planChip = !s.planExpiresAt
                        ? { cls: "chip-danger", label: "ยังไม่มีแพ็กเกจ" }
                        : daysLeft <= 0
                          ? { cls: "chip-danger", label: "หมดอายุ" }
                          : daysLeft <= 7
                            ? { cls: "chip-warning", label: `เหลือ ${daysLeft} วัน` }
                            : { cls: "chip-success", label: `ถึง ${formatDate(s.planExpiresAt)}` }
                      return (
                        <tr key={s.id} style={{ borderTop: "1px solid var(--line)" }}>
                          <td style={{ padding: "10px 12px" }}>
                            <strong>{s.name}</strong>
                            <div className="t-caption num">/{s.slug}</div>
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <span className={`chip ${s.status === "ACTIVE" ? "chip-success" : "chip-danger"}`}>
                              <span className="dot" />
                              {s.status === "ACTIVE" ? "ใช้งาน" : "ถูกระงับ"}
                            </span>
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <span className={`chip ${planChip.cls}`}>
                              <span className="dot" />
                              {s.planTier ? `${TIER_SPEC[s.planTier].label} · ` : ""}
                              {planChip.label}
                            </span>
                          </td>
                          <td className="num" style={{ padding: "10px 12px", textAlign: "right" }}>
                            {s.tableCount}/{s.tableLimit}
                          </td>
                          <td style={{ padding: "10px 12px" }} className="t-small">
                            {s.pendingRequestRef ? (
                              <span className="num">
                                รอยืนยัน {s.pendingRequestRef}
                                {s.pendingInBatch ? " (ใบรวม)" : ""}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <h3 className="t-h3">ดึงร้านที่มีอยู่เข้าแบรนด์</h3>
              <p className="t-caption" style={{ margin: "4px 0 8px" }}>
                เฉพาะร้านที่คุณเป็นเจ้าของโดยตรงและยังไม่อยู่ใต้แบรนด์ใด · ย้ายร้านระหว่างแบรนด์ยังทำไม่ได้ในเวอร์ชันนี้
              </p>
              <AttachStoreForm attachable={overview.attachable} />
            </div>
          </section>

          {ctx && copySources.length > 0 ? (
            <section className="card-ui card-pad">
              <h2 className="t-h2">คัดลอกเมนูข้ามสาขา</h2>
              <p className="t-caption" style={{ margin: "4px 0 10px" }}>
                ได้สำเนาอิสระ (เมนู + ตัวเลือกเสริม) — แก้ราคา/ซ่อนรายการที่สาขาปลายทางไม่กระทบต้นทาง · รายการชื่อซ้ำถูกข้าม
                · เมนูแนะนำไม่ติดไป ตั้งเองที่ตั้งค่าร้าน
              </p>
              <CopyMenuForm activeStoreName={ctx.store.name} sources={copySources} />
            </section>
          ) : null}

          {overview.pendingBatch ? (
            <div className="alert-banner info">
              มีใบจ่ายรวม <span className="num">{overview.pendingBatch.requestRef}</span> ยอด{" "}
              <span className="num">{formatBaht(overview.pendingBatch.amount)}</span> รอผู้ดูแลยืนยัน —{" "}
              <Link href="/brand/billing">ดู QR และรายละเอียด</Link>
            </div>
          ) : null}
        </>
      )}
    </>
  )
}
