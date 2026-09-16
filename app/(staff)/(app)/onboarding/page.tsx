import { redirect } from "next/navigation"
import { getSession, resolveStoreContext } from "@/lib/session"
import { PendingInvites } from "@/components/pending-invites"
import { OnboardingForm } from "@/components/onboarding-form"
// แบรนด์ของผู้ใช้ (Phase 14c) — อ่านตรงเพราะยังไม่มี storeId ให้ forStore() (หน้านี้ใช้ได้ทั้งคนที่ยังไม่มีร้าน)
import { prisma } from "@/lib/prisma"

export const metadata = { title: "สร้างร้าน" }

/// Onboarding (Phase 14a) — ผู้ใช้ที่ล็อกอินแล้วสร้างร้านของตัวเอง
/// ใช้ได้ทั้งคนที่ยังไม่มีร้าน (มาจาก /no-store) และคนที่มีร้านแล้วอยากเปิดสาขาเพิ่ม (มาจากตัวสลับร้าน)
export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const [result, session, params] = await Promise.all([resolveStoreContext(), getSession(), searchParams])
  if ((!result.ok && result.reason === "UNAUTHENTICATED") || !session?.user) redirect("/login?callbackUrl=%2Fonboarding")
  const memberships = result.ok ? result.context.memberships : result.memberships
  const hasExistingStore = memberships.length > 0

  // Phase 14c — ถ้ามีแบรนด์ ให้เลือกสร้างเป็นสาขาใต้แบรนด์ + คัดลอกเมนูจากสาขาที่เป็นเจ้าของ
  const brand = await prisma.brand.findFirst({ where: { ownerId: session.user.id }, select: { id: true, name: true } })
  const ownedStores = memberships.filter((m) => m.role === "OWNER").map((m) => ({ id: m.storeId, name: m.name }))
  const joinBrandDefault = params.brand === "1"

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">เริ่มต้นใช้งาน</p>
          <h1 className="t-h1">{hasExistingStore ? "สร้างร้านเพิ่ม" : "สร้างร้านของคุณ"}</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            {hasExistingStore
              ? "แต่ละร้าน/สาขามีเมนู โต๊ะ QR และรายงานแยกกัน — คุณจะเป็นเจ้าของร้านใหม่นี้ทันที และสลับร้านได้จากแถบด้านบน"
              : "ตั้งชื่อร้านและสีแบรนด์ — คุณจะเป็นเจ้าของร้าน (OWNER) จากนั้นรับสิทธิ์ทดลองใช้ฟรี 7 วันด้วยเลขพร้อมเพย์ของร้าน แล้วเริ่มรับออเดอร์ผ่าน QR ได้เลย"}
          </p>
        </div>
      </div>

      {hasExistingStore ? null : <PendingInvites email={session.user.email} />}
      <OnboardingForm hasExistingStore={hasExistingStore} brand={brand} ownedStores={ownedStores} joinBrandDefault={joinBrandDefault} />
    </>
  )
}
