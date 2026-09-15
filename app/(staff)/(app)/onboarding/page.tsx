import { redirect } from "next/navigation"
import { getSession, resolveStoreContext } from "@/lib/session"
import { PendingInvites } from "@/components/pending-invites"
import { OnboardingForm } from "@/components/onboarding-form"

export const metadata = { title: "สร้างร้าน" }

/// Onboarding (Phase 14a) — ผู้ใช้ที่ล็อกอินแล้วสร้างร้านของตัวเอง
/// ใช้ได้ทั้งคนที่ยังไม่มีร้าน (มาจาก /no-store) และคนที่มีร้านแล้วอยากเปิดสาขาเพิ่ม (มาจากตัวสลับร้าน)
export default async function OnboardingPage() {
  const [result, session] = await Promise.all([resolveStoreContext(), getSession()])
  if ((!result.ok && result.reason === "UNAUTHENTICATED") || !session?.user) redirect("/login?callbackUrl=%2Fonboarding")
  const hasExistingStore = (result.ok ? result.context.memberships : result.memberships).length > 0

  return (
    <>
      <div className="page-head">
        <div>
          <p className="t-eyebrow">เริ่มต้นใช้งาน</p>
          <h1 className="t-h1">{hasExistingStore ? "สร้างร้านเพิ่ม" : "สร้างร้านของคุณ"}</h1>
          <p className="t-body" style={{ marginTop: 4 }}>
            {hasExistingStore
              ? "แต่ละร้าน/สาขามีเมนู โต๊ะ QR และรายงานแยกกัน — คุณจะเป็นเจ้าของร้านใหม่นี้ทันที และสลับร้านได้จากแถบด้านบน"
              : "ตั้งชื่อร้านและสีแบรนด์ แล้วเริ่มรับออเดอร์ผ่าน QR ได้เลย — คุณจะเป็นเจ้าของร้าน (OWNER) และเชิญพนักงานเพิ่มได้ทีหลัง"}
          </p>
        </div>
      </div>

      {hasExistingStore ? null : <PendingInvites email={session.user.email} />}
      <OnboardingForm hasExistingStore={hasExistingStore} />
    </>
  )
}
