import Link from "next/link"
import { redirect } from "next/navigation"
import { getSession, resolveStoreContext } from "@/lib/session"
import { PendingInvites } from "@/components/pending-invites"
import { IconStore } from "@/components/icons"

export const metadata = { title: "ยังไม่มีร้าน" }

/// ปลายทางของ requirePageAccess()/requireStorePage() เมื่อล็อกอินแล้วแต่ "ไม่มีร้านให้ทำงาน" (Phase 13)
/// — ยังไม่ได้อยู่ในร้านใด (รอเจ้าของร้านเชิญ) หรือร้านที่เลือกอยู่ถูกระงับ
/// ตั้งใจให้เป็นหน้าอธิบาย ไม่ใช่ error 500 · เคส "ไม่มีร้าน" ชี้ไป /onboarding ให้สร้างร้านเอง (Phase 14a)
export default async function NoStorePage({
  searchParams,
}: PageProps<"/no-store">) {
  const [result, session] = await Promise.all([
    resolveStoreContext(),
    getSession(),
  ])
  // มีร้านใช้งานได้แล้ว (เช่น เพิ่งถูกเชิญ) → ไม่ต้องค้างหน้านี้
  if (result.ok) redirect("/")
  if (result.reason === "UNAUTHENTICATED" || !session?.user) redirect("/login")

  const params = await searchParams
  const reason =
    params.reason === "STORE_SUSPENDED" || result.reason === "STORE_SUSPENDED"
      ? "STORE_SUSPENDED"
      : "NO_STORE"
  const otherActiveStores = result.memberships.filter(
    (m) => m.status === "ACTIVE",
  )

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {reason === "NO_STORE" ? (
        <PendingInvites email={session.user.email} />
      ) : null}
      <section className="card-ui card-pad" style={{ maxWidth: 560 }}>
        <span
          className={`chip ${reason === "STORE_SUSPENDED" ? "chip-danger" : "chip-warning"}`}
        >
          <span className="dot" />
          {reason === "STORE_SUSPENDED" ? "ร้านถูกระงับ" : "ยังไม่มีร้าน"}
        </span>

        <h1 className="t-h1" style={{ marginTop: 12 }}>
          <IconStore size={22} aria-hidden />{" "}
          {reason === "STORE_SUSPENDED"
            ? "ร้านนี้ถูกระงับการใช้งาน"
            : "บัญชีของคุณยังไม่ได้อยู่ในร้านใด"}
        </h1>

        <p className="t-body" style={{ marginTop: 10 }}>
          {reason === "STORE_SUSPENDED"
            ? "ผู้ดูแลระบบระงับร้านนี้ไว้ชั่วคราว ข้อมูลยังอยู่ครบแต่ใช้งานไม่ได้จนกว่าจะปลดระงับ กรุณาติดต่อผู้ดูแลระบบ"
            : "สร้างร้านของคุณเองได้เลย (คุณจะเป็นเจ้าของร้าน) — หรือถ้าคุณเป็นพนักงาน ให้เจ้าของร้านส่งคำเชิญมาที่อีเมลนี้แล้วกดลิงก์ในอีเมล"}
        </p>

        {otherActiveStores.length > 0 ? (
          <div className="alert-banner info" style={{ marginTop: 14 }}>
            คุณยังอยู่ในร้านอื่นที่ใช้งานได้ {otherActiveStores.length} ร้าน —
            สลับร้านได้จากแถบด้านบน
          </div>
        ) : null}

        <div className="row" style={{ gap: 8, marginTop: 16 }}>
          {reason === "NO_STORE" ? (
            <Link href="/onboarding" className="btn btn-primary">
              <IconStore size={17} aria-hidden />
              สร้างร้านของคุณ
            </Link>
          ) : null}
          <Link
            href="/settings"
            className={
              reason === "NO_STORE" ? "btn btn-ghost" : "btn btn-primary"
            }
          >
            ไปหน้าตั้งค่าโปรไฟล์
          </Link>
        </div>
      </section>
    </div>
  )
}
