import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { hashInviteToken } from "@/lib/invite-token"
import {
  disconnectTestDb,
  ensureTestStore,
  ensureTestUser,
  isTestDbReachable,
  OTHER_STORE_ID,
  resetDb,
  TEST_STORE_ID,
  testPrisma,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { setActiveTestStore, setTestUser } from "../helpers/session-mock"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

const cookieSet = vi.fn()
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: () => undefined, set: cookieSet, delete: vi.fn() })),
}))

/// ดักอีเมล — เทสต้องการแค่ "ถูกเรียกด้วยลิงก์อะไร" และจำลองกรณีส่งไม่สำเร็จ
const sendInviteMock = vi.fn(async () => ({ ok: true as const, skipped: false }))
vi.mock("@/lib/mail", () => ({
  sendStoreInviteMail: (...args: unknown[]) => sendInviteMock(...(args as [])),
  sendVerificationMail: vi.fn(),
  sendResetPasswordMail: vi.fn(),
}))

const dbReady = await isTestDbReachable()

type InviteArgs = [string, { storeName: string; inviterName: string; role: string; url: string }]

/// ดึง token ดิบจาก URL ในอีเมลที่ส่งครั้งล่าสุด — ทางเดียวที่จะได้ token เพราะฐานเก็บแค่ hash
function lastInviteToken(): string {
  const calls = sendInviteMock.mock.calls as unknown as InviteArgs[]
  const last = calls.at(-1)
  if (!last) throw new Error("ยังไม่มีอีเมลถูกส่ง")
  return last[1].url.split("/invite/")[1]
}

describe.skipIf(!dbReady)("คำเชิญเข้าร้าน (Phase 14a — StoreInvite)", () => {
  let actions: typeof import("@/app/actions/store-members")
  let queries: typeof import("@/lib/queries")

  beforeAll(async () => {
    actions = await import("@/app/actions/store-members")
    queries = await import("@/lib/queries")
  })

  beforeEach(async () => {
    await resetDb()
    cookieSet.mockClear()
    sendInviteMock.mockClear()
    sendInviteMock.mockResolvedValue({ ok: true, skipped: false })
    await ensureTestUser("owner", "เจ้าของร้าน", { storeId: TEST_STORE_ID, role: "OWNER" })
    await ensureTestUser("staff", "พนักงานเดิม", { storeId: TEST_STORE_ID, role: "STAFF" })
    // คนถูกเชิญ — มีบัญชีแล้ว (อีเมล invitee@example.com) แต่ยังไม่อยู่ร้านไหน
    await ensureTestUser("invitee", "คนถูกเชิญ", { storeId: null })
    setTestUser("owner")
    setActiveTestStore(TEST_STORE_ID)
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  async function inviteAsOwner(email = "invitee@example.com", role: "OWNER" | "STAFF" = "STAFF") {
    setTestUser("owner")
    setActiveTestStore(TEST_STORE_ID)
    const result = await actions.inviteMember(makeFormData({ email, role }))
    expect(result.ok, JSON.stringify(result)).toBe(true)
    return lastInviteToken()
  }

  // ───────────── inviteMember ─────────────

  it("เจ้าของร้านเชิญได้ → มีแถว StoreInvite (เก็บแค่ hash) และอีเมลถูกส่งพร้อมลิงก์ /invite/<token>", async () => {
    const token = await inviteAsOwner()
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/)

    const rows = await testPrisma().storeInvite.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0].storeId).toBe(TEST_STORE_ID)
    expect(rows[0].email).toBe("invitee@example.com")
    expect(rows[0].role).toBe("STAFF")
    expect(rows[0].tokenHash).toBe(hashInviteToken(token))
    // token ดิบไม่อยู่ในฐาน
    expect(JSON.stringify(rows)).not.toContain(token)
    expect(rows[0].expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000)

    const [to, payload] = sendInviteMock.mock.calls[0] as unknown as InviteArgs
    expect(to).toBe("invitee@example.com")
    expect(payload.inviterName).toBe("เจ้าของร้าน")
    expect(payload.role).toBe("STAFF")
  })

  it("อีเมลถูก normalize เป็นตัวพิมพ์เล็ก", async () => {
    await inviteAsOwner("Invitee@Example.COM")
    expect((await testPrisma().storeInvite.findFirstOrThrow()).email).toBe("invitee@example.com")
  })

  it("STAFF เชิญไม่ได้ (requireOwner)", async () => {
    setTestUser("staff")
    const result = await actions.inviteMember(makeFormData({ email: "x@example.com", role: "STAFF" }))
    expect(result.ok).toBe(false)
    expect(await testPrisma().storeInvite.count()).toBe(0)
    expect(sendInviteMock).not.toHaveBeenCalled()
  })

  it("เชิญอีเมลที่เป็นสมาชิกร้านอยู่แล้ว → ok:false", async () => {
    const result = await actions.inviteMember(makeFormData({ email: "staff@example.com", role: "STAFF" }))
    expect(result.ok).toBe(false)
    expect(await testPrisma().storeInvite.count()).toBe(0)
  })

  it("เชิญอีเมลเดิมซ้ำ → ใบเก่าถูก revoke ใบใหม่ใช้ได้ (ลิงก์เก่าตายทันที)", async () => {
    const oldToken = await inviteAsOwner()
    const newToken = await inviteAsOwner()
    expect(newToken).not.toBe(oldToken)

    const rows = await testPrisma().storeInvite.findMany({ orderBy: { createdAt: "asc" } })
    expect(rows).toHaveLength(2)
    expect(rows[0].revokedAt).not.toBeNull()
    expect(rows[1].revokedAt).toBeNull()

    expect((await queries.lookupInvite(oldToken)).ok).toBe(false)
    expect((await queries.lookupInvite(newToken)).ok).toBe(true)
  })

  it("อีเมลไม่ถูกรูปแบบ / บทบาทผิด → ok:false พร้อม fieldErrors", async () => {
    const bad = await actions.inviteMember(makeFormData({ email: "not-an-email", role: "STAFF" }))
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.fieldErrors?.email).toBeTruthy()
    const badRole = await actions.inviteMember(makeFormData({ email: "a@example.com", role: "ADMIN" }))
    expect(badRole.ok).toBe(false)
  })

  it("ส่งอีเมลไม่สำเร็จ → แถวยังอยู่ คืน ok:true พร้อมลิงก์ให้ส่งเอง", async () => {
    sendInviteMock.mockResolvedValueOnce({ ok: false, error: "Resend ตอบ 500" } as never)
    const result = await actions.inviteMember(makeFormData({ email: "invitee@example.com", role: "STAFF" }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data?.inviteUrl).toContain("/invite/")
      expect(result.message).toContain("ส่งอีเมลไม่สำเร็จ")
    }
    expect(await testPrisma().storeInvite.count()).toBe(1)
  })

  // ───────────── lookupInvite / listPendingInvites ─────────────

  it("lookupInvite คืนข้อมูลร้าน/ผู้เชิญ/อีเมล และแยกเหตุผลที่ใช้ไม่ได้ได้ครบ", async () => {
    const token = await inviteAsOwner()
    const found = await queries.lookupInvite(token)
    expect(found).toMatchObject({ ok: true, storeId: TEST_STORE_ID, inviterName: "เจ้าของร้าน", email: "invitee@example.com", role: "STAFF" })

    expect(await queries.lookupInvite("garbage")).toEqual({ ok: false, reason: "NOT_FOUND" })
    expect(await queries.lookupInvite("A".repeat(43))).toEqual({ ok: false, reason: "NOT_FOUND" })

    await testPrisma().storeInvite.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
    expect(await queries.lookupInvite(token)).toEqual({ ok: false, reason: "EXPIRED" })

    await testPrisma().storeInvite.updateMany({ data: { expiresAt: new Date(Date.now() + 100000), revokedAt: new Date() } })
    expect(await queries.lookupInvite(token)).toEqual({ ok: false, reason: "REVOKED" })

    await testPrisma().store.update({ where: { id: TEST_STORE_ID }, data: { status: "SUSPENDED" } })
    expect(await queries.lookupInvite(token)).toEqual({ ok: false, reason: "STORE_SUSPENDED" })
  })

  it("listPendingInvites เห็นเฉพาะใบที่ยังใช้ได้ของร้านตัวเอง", async () => {
    await inviteAsOwner("a@example.com")
    await inviteAsOwner("b@example.com")
    await ensureTestStore({ id: OTHER_STORE_ID })
    await testPrisma().storeInvite.create({
      data: { storeId: OTHER_STORE_ID, email: "c@example.com", tokenHash: "hash-c", expiresAt: new Date(Date.now() + 100000), invitedById: "owner" },
    })
    await testPrisma().storeInvite.create({
      data: { storeId: TEST_STORE_ID, email: "expired@example.com", tokenHash: "hash-e", expiresAt: new Date(Date.now() - 1000), invitedById: "owner" },
    })

    const pending = await queries.listPendingInvites(TEST_STORE_ID)
    expect(pending.map((p) => p.email).sort()).toEqual(["a@example.com", "b@example.com"])
    expect(pending[0].invitedByName).toBe("เจ้าของร้าน")
  })

  it("listPendingInvitesForEmail (ทางของ /no-store) เห็นเฉพาะคำเชิญค้างของอีเมลตัวเองจากร้านที่ยัง ACTIVE", async () => {
    const { listPendingInvitesForEmail } = await import("@/lib/store-resolve")
    await inviteAsOwner()
    await ensureTestStore({ id: OTHER_STORE_ID })
    await ensureTestUser("owner-b", "เจ้าของ B", { storeId: OTHER_STORE_ID, role: "OWNER" })
    await testPrisma().storeInvite.create({
      data: { storeId: OTHER_STORE_ID, email: "invitee@example.com", tokenHash: "hash-b", expiresAt: new Date(Date.now() + 100000), invitedById: "owner-b" },
    })

    const mine = await listPendingInvitesForEmail("Invitee@Example.com")
    expect(mine.map((i) => i.storeId).sort()).toEqual([OTHER_STORE_ID, TEST_STORE_ID].sort())
    expect(await listPendingInvitesForEmail("nobody@example.com")).toEqual([])

    await testPrisma().store.update({ where: { id: OTHER_STORE_ID }, data: { status: "SUSPENDED" } })
    expect((await listPendingInvitesForEmail("invitee@example.com")).map((i) => i.storeId)).toEqual([TEST_STORE_ID])
  })

  // ───────────── revokeInvite ─────────────

  it("เจ้าของร้านยกเลิกคำเชิญได้ · ยกเลิกซ้ำ → ok:false · STAFF ยกเลิกไม่ได้", async () => {
    await inviteAsOwner()
    const { id } = await testPrisma().storeInvite.findFirstOrThrow()

    setTestUser("staff")
    expect((await actions.revokeInvite(makeFormData({ id }))).ok).toBe(false)

    setTestUser("owner")
    expect((await actions.revokeInvite(makeFormData({ id }))).ok).toBe(true)
    expect((await testPrisma().storeInvite.findUniqueOrThrow({ where: { id } })).revokedAt).not.toBeNull()
    expect((await actions.revokeInvite(makeFormData({ id }))).ok).toBe(false)
  })

  // ───────────── acceptInvite ─────────────

  it("ผู้ถูกเชิญตอบรับด้วย token → เป็น STAFF ของร้าน + acceptedAt/acceptedById + cookie ชี้ร้านนั้น", async () => {
    const token = await inviteAsOwner()
    setTestUser("invitee")
    setActiveTestStore(null)

    const result = await actions.acceptInvite(makeFormData({ token }))
    expect(result.ok, JSON.stringify(result)).toBe(true)

    const member = await testPrisma().storeMember.findUnique({ where: { userId_storeId: { userId: "invitee", storeId: TEST_STORE_ID } } })
    expect(member?.role).toBe("STAFF")
    const invite = await testPrisma().storeInvite.findFirstOrThrow()
    expect(invite.acceptedAt).not.toBeNull()
    expect(invite.acceptedById).toBe("invitee")
    expect(cookieSet).toHaveBeenCalledWith("activeStoreId", TEST_STORE_ID, expect.anything())
  })

  it("เชิญเป็น OWNER → ตอบรับแล้วได้ OWNER", async () => {
    const token = await inviteAsOwner("invitee@example.com", "OWNER")
    setTestUser("invitee")
    expect((await actions.acceptInvite(makeFormData({ token }))).ok).toBe(true)
    const member = await testPrisma().storeMember.findUniqueOrThrow({ where: { userId_storeId: { userId: "invitee", storeId: TEST_STORE_ID } } })
    expect(member.role).toBe("OWNER")
  })

  it("ตอบรับด้วย inviteId (ทางของ /no-store) ได้เฉพาะเจ้าของอีเมลนั้น", async () => {
    await inviteAsOwner()
    const { id } = await testPrisma().storeInvite.findFirstOrThrow()

    // คนอื่นเอา id ไปกดไม่ได้
    await ensureTestUser("stranger", "คนแปลกหน้า", { storeId: null })
    setTestUser("stranger")
    expect((await actions.acceptInvite(makeFormData({ inviteId: id }))).ok).toBe(false)
    expect(await testPrisma().storeMember.count({ where: { userId: "stranger" } })).toBe(0)

    setTestUser("invitee")
    expect((await actions.acceptInvite(makeFormData({ inviteId: id }))).ok).toBe(true)
    expect(await testPrisma().storeMember.count({ where: { userId: "invitee", storeId: TEST_STORE_ID } })).toBe(1)
  })

  it("อีเมลของบัญชีที่ล็อกอินไม่ตรงกับคำเชิญ → ok:false ไม่มี StoreMember และคำเชิญยังใช้ได้", async () => {
    const token = await inviteAsOwner()
    await ensureTestUser("stranger", "คนแปลกหน้า", { storeId: null })
    setTestUser("stranger")

    const result = await actions.acceptInvite(makeFormData({ token }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("invitee@example.com")
    expect(await testPrisma().storeMember.count({ where: { userId: "stranger" } })).toBe(0)
    expect((await testPrisma().storeInvite.findFirstOrThrow()).acceptedAt).toBeNull()
  })

  it("token ผิด / หมดอายุ / ถูกยกเลิก / ใช้ไปแล้ว / ร้านถูกระงับ → ok:false ทุกกรณี", async () => {
    const token = await inviteAsOwner()
    setTestUser("invitee")
    const db = testPrisma()

    expect((await actions.acceptInvite(makeFormData({ token: "Z".repeat(43) }))).ok).toBe(false)
    expect((await actions.acceptInvite(makeFormData({ token: "short" }))).ok).toBe(false)
    expect((await actions.acceptInvite(makeFormData({}))).ok).toBe(false)

    await db.storeInvite.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await actions.acceptInvite(makeFormData({ token }))).ok).toBe(false)

    await db.storeInvite.updateMany({ data: { expiresAt: new Date(Date.now() + 100000), revokedAt: new Date() } })
    expect((await actions.acceptInvite(makeFormData({ token }))).ok).toBe(false)

    await db.storeInvite.updateMany({ data: { revokedAt: null } })
    await db.store.update({ where: { id: TEST_STORE_ID }, data: { status: "SUSPENDED" } })
    expect((await actions.acceptInvite(makeFormData({ token }))).ok).toBe(false)
    await db.store.update({ where: { id: TEST_STORE_ID }, data: { status: "ACTIVE" } })

    expect((await actions.acceptInvite(makeFormData({ token }))).ok).toBe(true)
    expect((await actions.acceptInvite(makeFormData({ token }))).ok).toBe(false)
    expect(await db.storeMember.count({ where: { userId: "invitee" } })).toBe(1)
  })

  it("ยังไม่ล็อกอิน → ok:false", async () => {
    const token = await inviteAsOwner()
    setTestUser(null)
    expect((await actions.acceptInvite(makeFormData({ token }))).ok).toBe(false)
  })

  it("★ กดรับพร้อมกัน 5 ครั้งด้วย token เดียว → สำเร็จครั้งเดียว (updateMany where acceptedAt: null)", async () => {
    const token = await inviteAsOwner()
    setTestUser("invitee")

    const results = await Promise.all(Array.from({ length: 5 }, () => actions.acceptInvite(makeFormData({ token }))))
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(await testPrisma().storeMember.count({ where: { userId: "invitee", storeId: TEST_STORE_ID } })).toBe(1)
  })

  it("ผู้ถูกเชิญที่ถูกเพิ่มเป็น OWNER ไปก่อนแล้ว ตอบรับคำเชิญ STAFF → บทบาทเดิมไม่ถูกลด", async () => {
    const token = await inviteAsOwner()
    await testPrisma().storeMember.create({ data: { userId: "invitee", storeId: TEST_STORE_ID, role: "OWNER" } })
    setTestUser("invitee")
    expect((await actions.acceptInvite(makeFormData({ token }))).ok).toBe(true)
    const member = await testPrisma().storeMember.findUniqueOrThrow({ where: { userId_storeId: { userId: "invitee", storeId: TEST_STORE_ID } } })
    expect(member.role).toBe("OWNER")
  })
})
