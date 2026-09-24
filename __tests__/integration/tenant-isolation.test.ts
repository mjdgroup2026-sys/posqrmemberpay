import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActionResult } from "@/lib/types"
import {
  addTestMember,
  disconnectTestDb,
  ensureTestStore,
  ensureTestUser,
  isTestDbReachable,
  OTHER_STORE_ID,
  resetDb,
  testPrisma,
  TEST_STORE_ID,
} from "../helpers/db"
import { makeFormData } from "../helpers/form"
import { addDays, businessDayKey } from "@/lib/day"
import { setActiveTestStore, setTestUser } from "../helpers/session-mock"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/session", async () => (await import("../helpers/session-mock")).sessionMockModule())

/// ดักการยิงออกไปหาธนาคาร — เทส webhook ด้านล่างต้องการแค่ "ธนาคารยืนยันว่าจ่ายแล้ว"
const inquireMock = vi.fn()
vi.mock("@/lib/payment-provider/scb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payment-provider/scb")>()
  return { ...actual, inquireBillPayment: (...args: unknown[]) => inquireMock(...args) }
})

const dbReady = await isTestDbReachable()

/// การแยกข้อมูลตามร้าน (Phase 13) — "ลืม where: { storeId } จุดเดียว = ร้านหนึ่งเห็นบิล/ลูกค้าของอีกร้าน"
///
/// เทสนี้สร้างร้าน A และ B พร้อมข้อมูลครบทุก entity ที่มี storeId แล้วพิสูจน์ 2 อย่าง:
///   1. ทุกฟังก์ชันอ่านใน lib/queries.ts เรียกใต้ร้าน A ต้องไม่มีข้อมูลของ B หลุดมาแม้แต่ค่าเดียว
///   2. ทุก Server Action ที่รับ id จากผู้ใช้ เมื่อยิงด้วย id ของร้าน B ต้องตอบ ok:false
///      และแถวของ B ต้องไม่ถูกแตะ (ไม่ใช่ 500 และไม่ใช่สำเร็จ)
/// ตาราง it.each ด้านล่างมีด่านตรวจว่า export ทุกตัวถูกใส่ในตารางแล้ว — เพิ่ม query/action ใหม่
/// โดยไม่เพิ่มในตารางนี้ = เทสแดง จะได้ไม่มีฟังก์ชันหลุดรอดไปโดยไม่ถูกตรวจ

type StoreFixture = {
  storeId: string
  ownerId: string
  tag: string
  categoryId: string
  productId: string
  saleId: string
  saleNumber: string
  closingId: string
  tableId: string
  table2Id: string
  qrToken: string
  qrId: string
  sessionId: string
  menuItemId: string
  modifierGroupId: string
  orderId: string
  orderItemId: string
  notificationId: string
  intentId: string
  intentRef1: string
  memberPhone: string
  roleId: string
  staffId: string
  inviteId: string
  inviteEmail: string
  subscriptionId: string
  subscriptionRef: string
  assetId: string
  /// Phase 19 — ประเภทครัว
  stationId: string
  /// Phase 20 — พนักงานนวด + บรรทัดโปรแกรมนวด
  therapistId: string
  serviceItemId: string
  /// Phase 20b — คิวจอง + กะของวันนี้
  bookingId: string
  roomId: string
  bookingCustomer: string
}

describe.skipIf(!dbReady)("การแยกข้อมูลตามร้าน (Phase 13 — tenant isolation)", () => {
  let queries: typeof import("@/lib/queries")
  let actions: Record<string, (formData: FormData) => Promise<ActionResult<unknown>>>
  let actionModules: Record<string, Record<string, unknown>>
  let A: StoreFixture
  let B: StoreFixture

  beforeAll(async () => {
    queries = await import("@/lib/queries")
    actionModules = {
      categories: await import("@/app/actions/categories"),
      closing: await import("@/app/actions/closing"),
      "customer-order": await import("@/app/actions/customer-order"),
      members: await import("@/app/actions/members"),
      menu: await import("@/app/actions/menu"),
      notifications: await import("@/app/actions/notifications"),
      orders: await import("@/app/actions/orders"),
      payments: await import("@/app/actions/payments"),
      products: await import("@/app/actions/products"),
      profile: await import("@/app/actions/profile"),
      "qr-codes": await import("@/app/actions/qr-codes"),
      roles: await import("@/app/actions/roles"),
      sales: await import("@/app/actions/sales"),
      settings: await import("@/app/actions/settings"),
      stock: await import("@/app/actions/stock"),
      "store-members": await import("@/app/actions/store-members"),
      tables: await import("@/app/actions/tables"),
      onboarding: await import("@/app/actions/onboarding"),
      admin: await import("@/app/actions/admin"),
      billing: await import("@/app/actions/billing"),
      "admin-billing": await import("@/app/actions/admin-billing"),
      brand: await import("@/app/actions/brand"),
      "payment-config": await import("@/app/actions/payment-config"),
      "scb-config": await import("@/app/actions/scb-config"),
      assets: await import("@/app/actions/assets"),
      "staff-order": await import("@/app/actions/staff-order"),
      therapists: await import("@/app/actions/therapists"),
      bookings: await import("@/app/actions/bookings"),
      "therapist-shifts": await import("@/app/actions/therapist-shifts"),
    }
    actions = Object.assign({}, ...Object.values(actionModules)) as typeof actions
  })

  beforeEach(async () => {
    await resetDb()
    await ensureTestUser("owner-a", "เจ้าของร้าน A", { storeId: TEST_STORE_ID, role: "OWNER" })
    await ensureTestStore({ id: OTHER_STORE_ID, name: "ร้านทดสอบ B" })
    await ensureTestUser("owner-b", "เจ้าของร้าน B", { storeId: OTHER_STORE_ID, role: "OWNER" })
    A = await seedStore(TEST_STORE_ID, "owner-a", "A")
    B = await seedStore(OTHER_STORE_ID, "owner-b", "B")
    // ทุกเทสเรียกในฐานะเจ้าของร้าน A
    setTestUser("owner-a")
    setActiveTestStore(TEST_STORE_ID)
  })

  afterAll(async () => {
    await disconnectTestDb()
  })

  /// ข้อมูลครบทุก entity ที่มี storeId — ชื่อทุกอย่างมี tag ของร้าน ("A"/"B") ไว้ตรวจว่าหลุดข้ามร้านไหม
  async function seedStore(storeId: string, ownerId: string, tag: string): Promise<StoreFixture> {
    const db = testPrisma()
    const suffix = tag.toLowerCase()

    const staff = await ensureTestUser(`staff-${suffix}`, `พนักงานร้าน ${tag}`, { storeId, role: "STAFF" })

    const category = await db.category.create({ data: { storeId, name: `หมวดร้าน ${tag}` } })
    const product = await db.product.create({
      data: {
        storeId,
        sku: `SKU-${tag}-1`,
        name: `สินค้าร้าน ${tag}`,
        categoryId: category.id,
        unit: "ชิ้น",
        quantity: 10,
        reorderPoint: 20, // ต่ำกว่าจุดสั่งซื้อ → โผล่ในรายการใกล้หมด
        price: "50.00",
      },
    })
    await db.stockTransaction.create({
      data: { storeId, productId: product.id, type: "IN", quantity: 10, note: `รับเข้าร้าน ${tag}` },
    })
    await db.stockTransaction.create({
      data: { storeId, productId: product.id, type: "OUT", quantity: 2, note: `เบิกร้าน ${tag}` },
    })

    const sale = await db.sale.create({
      data: {
        storeId,
        saleNumber: "INV-000001",
        subtotal: "100.00",
        discount: "0.00",
        total: "100.00",
        paymentMethod: "CASH",
        amountReceived: "100.00",
        changeDue: "0.00",
        cashierId: ownerId,
        note: `บิลร้าน ${tag}`,
        items: {
          create: [{ productId: product.id, kind: "PRODUCT", name: `สินค้าร้าน ${tag}`, quantity: 2, unitPrice: "50.00", subtotal: "100.00" }],
        },
      },
    })
    const closing = await db.cashierClosing.create({
      data: {
        storeId,
        cashierId: ownerId,
        closingDate: new Date(Date.UTC(2026, 0, 15)),
        totalSales: "100.00",
        totalCash: "100.00",
        totalTransfer: "0.00",
        totalQR: "0.00",
        billCount: 1,
        countedCash: "100.00",
        difference: "0.00",
        note: `ปิดยอดร้าน ${tag}`,
      },
    })

    const table = await db.table.create({ data: { storeId, code: `T${tag}1`, status: "ORDERED" } })
    const table2 = await db.table.create({ data: { storeId, code: `T${tag}2` } })
    const qr = await db.qRCode.create({
      data: { storeId, tableId: table.id, token: `qr-${suffix}-${Math.random().toString(36).slice(2, 10)}`, type: "STATIC" },
    })
    await db.qRCode.create({
      data: { storeId, tableId: table2.id, token: `qr-${suffix}2-${Math.random().toString(36).slice(2, 10)}`, type: "STATIC" },
    })
    const session = await db.tableSession.create({ data: { storeId, tableId: table.id, qrCodeId: qr.id } })

    const station = await db.kitchenStation.create({ data: { storeId, name: `ครัวร้าน ${tag}`, sortOrder: 0 } })
    const therapist = await db.therapist.create({
      data: { storeId, code: `T${tag}`, name: `พนักงานนวดร้าน ${tag}`, skills: { connect: [{ id: station.id }] } },
    })
    const menuItem = await db.menuItem.create({
      data: {
        storeId,
        name: `เมนูร้าน ${tag}`,
        stationId: station.id,
        price: "80.00",
        isFeatured: true,
        featuredSortOrder: 0,
        modifierGroups: {
          create: [
            {
              storeId,
              name: `ตัวเลือกร้าน ${tag}`,
              selectionType: "SINGLE",
              required: false,
              sortOrder: 1,
              options: { create: [{ name: `ออปชันร้าน ${tag}`, priceDelta: "0.00", sortOrder: 1 }] },
            },
          ],
        },
      },
      include: { modifierGroups: true },
    })
    const order = await db.mobileOrder.create({ data: { storeId, tableSessionId: session.id, orderNumber: 1 } })
    const orderItem = await db.mobileOrderItem.create({
      data: { mobileOrderId: order.id, menuItemId: menuItem.id, quantity: 1, unitPrice: "80.00", status: "AWAITING_KITCHEN" },
    })
    const serviceMenu = await db.menuItem.create({
      // ปิดขาย + ไม่ระบุประเภท + ราคาบรรทัด 0 โดยตั้งใจ — ไม่ให้กระทบเทสเดิมที่นับเมนู/ยอดบิลของ fixture (copyMenu ข้ามเมนูปิดขาย)
      data: { storeId, name: `โปรแกรมนวดร้าน ${tag}`, price: "300.00", itemType: "SERVICE", durationMinutes: 60, isActive: false },
    })
    const serviceItem = await db.mobileOrderItem.create({
      data: { mobileOrderId: order.id, menuItemId: serviceMenu.id, quantity: 1, unitPrice: "0.00", status: "AWAITING_KITCHEN", therapistId: therapist.id },
    })
    // Phase 20b — ห้องนวด + กะวันนี้ + คิวจองพรุ่งนี้เที่ยง (ใช้พรุ่งนี้เพื่อไม่ให้ชนกับเทสที่สร้างคิวของวันนี้เอง)
    const room = await db.table.create({ data: { storeId, code: `R${tag}`, kind: "ROOM", stationId: station.id } })
    const today = new Date(`${businessDayKey()}T00:00:00.000Z`)
    await db.therapistShift.create({
      data: { storeId, therapistId: therapist.id, workDate: today, startMinute: 8 * 60, endMinute: 22 * 60 },
    })
    const bookingStart = new Date(`${addDays(businessDayKey(), 1)}T05:00:00.000Z`)
    const booking = await db.booking.create({
      data: {
        storeId,
        customerName: `ลูกค้าจองร้าน ${tag}`,
        menuItemId: serviceMenu.id,
        durationMinutes: 60,
        therapistId: therapist.id,
        tableId: room.id,
        startAt: bookingStart,
        endAt: new Date(bookingStart.getTime() + 60 * 60_000),
      },
    })
    const notification = await db.notification.create({
      data: { storeId, tableSessionId: session.id, type: "CALL_STAFF", reason: `เรียกร้าน ${tag}` },
    })
    const intent = await db.paymentIntent.create({
      data: {
        storeId,
        ref1: `REF${tag}${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        tableSessionId: session.id,
        amount: "80.00",
        expiresAt: new Date(Date.now() + 15 * 60_000),
        // ออกไปแล้ว 10 นาที → เข้าข่าย "รอธนาคารยืนยันเกิน 5 นาที"
        createdAt: new Date(Date.now() - 10 * 60_000),
      },
    })
    const member = await db.member.create({
      data: { storeId, phone: `08${tag === "A" ? "1" : "2"}0000000`, pointBalance: 4 },
    })
    await db.memberPointTransaction.create({
      data: { memberId: member.id, saleId: sale.id, points: 4 },
    })
    const role = await db.role.create({ data: { storeId, name: `บทบาทร้าน ${tag}` } })
    // คำเชิญค้าง (Phase 14a) — อีเมล/hash มี tag ของร้านไว้จับการรั่ว
    const invite = await db.storeInvite.create({
      data: {
        storeId,
        email: `invitee-${suffix}@example.com`,
        tokenHash: `hash-${suffix}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        invitedById: ownerId,
      },
    })

    // บัญชีรับเงินของร้าน (Phase 15a) — ชื่อบัญชีมี tag ("ร้าน A/B" อยู่ใน fingerprint แล้ว)
    await db.storePaymentConfig.create({ data: { storeId, promptPayId: tag === "A" ? "0811111111" : "0822222222", accountName: `บัญชีร้าน ${tag}` } })

    // คำขอค่าใช้งานที่รอยืนยัน (Phase 14b) — requestRef มี tag ไว้จับการรั่ว
    const subscription = await db.storeSubscription.create({
      data: {
        storeId,
        kind: "RENEWAL",
        tier: "S",
        tableLimit: 12,
        days: 7,
        ratePerDay: "10.00",
        listPrice: "70.00",
        amount: "70.00",
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: "PENDING",
        paymentMethod: "PROMPTPAY",
        requestRef: `SUB-${tag}${tag}${tag}${tag}${tag}${tag}`,
        createdById: ownerId,
      },
    })

    // รูปที่ร้านอัปโหลดเอง (Phase 17a)
    const asset = await db.storeAsset.create({
      data: {
        storeId,
        contentType: "image/png",
        byteSize: 8,
        data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      },
      select: { id: true },
    })

    return {
      storeId,
      ownerId,
      tag,
      categoryId: category.id,
      productId: product.id,
      saleId: sale.id,
      saleNumber: sale.saleNumber,
      closingId: closing.id,
      tableId: table.id,
      table2Id: table2.id,
      qrToken: qr.token,
      qrId: qr.id,
      sessionId: session.id,
      menuItemId: menuItem.id,
      modifierGroupId: menuItem.modifierGroups[0].id,
      orderId: order.id,
      orderItemId: orderItem.id,
      notificationId: notification.id,
      intentId: intent.id,
      intentRef1: intent.ref1,
      memberPhone: member.phone,
      roleId: role.id,
      staffId: staff.id,
      inviteId: invite.id,
      inviteEmail: invite.email,
      subscriptionId: subscription.id,
      subscriptionRef: subscription.requestRef,
      assetId: asset.id,
      stationId: station.id,
      therapistId: therapist.id,
      serviceItemId: serviceItem.id,
      bookingId: booking.id,
      roomId: room.id,
      bookingCustomer: `ลูกค้าจองร้าน ${tag}`,
    }
  }

  /// ทุกค่าที่ "เป็นของ B" — ถ้าค่าใดโผล่ในผลลัพธ์ที่อ่านใต้ร้าน A แปลว่ารั่ว
  function fingerprintsOf(f: StoreFixture): string[] {
    return [
      f.categoryId,
      f.productId,
      f.saleId,
      f.closingId,
      f.tableId,
      f.table2Id,
      f.qrId,
      f.qrToken,
      f.sessionId,
      f.menuItemId,
      f.modifierGroupId,
      f.orderId,
      f.orderItemId,
      f.notificationId,
      f.intentId,
      f.intentRef1,
      f.memberPhone,
      f.roleId,
      f.staffId,
      f.ownerId,
      f.inviteId,
      f.inviteEmail,
      f.subscriptionId,
      f.subscriptionRef,
      f.stationId,
      f.therapistId,
      f.serviceItemId,
      f.bookingId,
      f.roomId,
      f.bookingCustomer,
      `ร้าน ${f.tag}`,
    ]
  }

  function expectNoLeak(result: unknown, other: StoreFixture) {
    const json = JSON.stringify(result, (_key, value) => (typeof value === "bigint" ? value.toString() : value))
    for (const marker of fingerprintsOf(other)) {
      expect(json, `พบ "${marker}" ของร้าน ${other.tag} ในผลลัพธ์`).not.toContain(marker)
    }
  }

  // ───────────────────── 1. lib/queries.ts ─────────────────────

  /// queries ที่รับ qrToken (ฝั่งลูกค้า) — ร้านมาจาก token เอง ไม่มี storeId ให้ส่ง ทดสอบแยกด้านล่าง
  const TOKEN_SCOPED_QUERIES = ["resolveCustomerSession", "getCustomerPaymentStatus", "lookupInvite"]

  type QueryCase = [name: string, run: (q: typeof queries, a: StoreFixture, b: StoreFixture) => Promise<unknown>]
  const QUERY_CASES: QueryCase[] = [
    ["listProducts", (q, a) => q.listProducts(a.storeId)],
    ["listProductOptions", (q, a) => q.listProductOptions(a.storeId)],
    ["listCategoryOptions", (q, a) => q.listCategoryOptions(a.storeId)],
    ["listCategoriesWithCount", (q, a) => q.listCategoriesWithCount(a.storeId)],
    ["getLowStockCount", (q, a) => q.getLowStockCount(a.storeId)],
    ["getLowStockProducts", (q, a) => q.getLowStockProducts(a.storeId)],
    ["getDashboardStats", (q, a) => q.getDashboardStats(a.storeId)],
    ["getRecentTransactions", (q, a) => q.getRecentTransactions(a.storeId)],
    ["listTransactions", (q, a) => q.listTransactions(a.storeId)],
    ["getMovementReport", (q, a) => q.getMovementReport(a.storeId)],
    ["getTopMovedProducts", (q, a) => q.getTopMovedProducts(a.storeId)],
    ["listUsers", (q, a) => q.listUsers(a.storeId)],
    ["listSales", (q, a) => q.listSales(a.storeId, {})],
    ["getSaleById", (q, a, b) => q.getSaleById(a.storeId, b.saleId)],
    ["getRecentSales", (q, a) => q.getRecentSales(a.storeId)],
    ["getSalesReport", (q, a) => q.getSalesReport(a.storeId)],
    ["getTopSellingProducts", (q, a) => q.getTopSellingProducts(a.storeId)],
    ["getPaymentBreakdown", (q, a) => q.getPaymentBreakdown(a.storeId)],
    ["getTodaySalesSummary", (q, a, b) => q.getTodaySalesSummary(a.storeId, b.ownerId)],
    ["getTodayClosing", (q, a, b) => q.getTodayClosing(a.storeId, b.ownerId)],
    ["listClosings", (q, a) => q.listClosings(a.storeId, {})],
    ["listTableOverview", (q, a) => q.listTableOverview(a.storeId)],
    ["listNotifications", (q, a) => q.listNotifications(a.storeId)],
    ["getPendingNotificationCount", (q, a) => q.getPendingNotificationCount(a.storeId)],
    ["listPaymentsAwaitingCallback", (q, a) => q.listPaymentsAwaitingCallback(a.storeId)],
    ["countPaymentsAwaitingCallback", (q, a) => q.countPaymentsAwaitingCallback(a.storeId)],
    ["listCustomerPaidBills", (q, a) => q.listCustomerPaidBills(a.storeId)],
    ["getTableDetail", (q, a, b) => q.getTableDetail(a.storeId, b.tableId)],
    // ?session= จากผู้ใช้ (ห้องสปาหลายบิล · 2026-09-23) — session ของร้านอื่นต้องไม่เปิดอะไรในร้านนี้
    ["getTableDetail", (q, a, b) => q.getTableDetail(a.storeId, a.tableId, b.sessionId)],
    ["getBillingView", (q, a, b) => q.getBillingView(a.storeId, a.tableId, b.sessionId)],
    ["listKitchenTickets", (q, a) => q.listKitchenTickets(a.storeId)],
    ["getStoreSettings", (q, a) => q.getStoreSettings(a.storeId)],
    ["listMenu", (q, a) => q.listMenu(a.storeId)],
    ["getMenuItem", (q, a, b) => q.getMenuItem(a.storeId, b.menuItemId)],
    ["getCustomerOrderView", (q, a, b) => q.getCustomerOrderView(a.storeId, b.sessionId)],
    ["listQrCodes", (q, a) => q.listQrCodes(a.storeId)],
    ["getBillingView", (q, a, b) => q.getBillingView(a.storeId, b.tableId)],
    ["getKitchenTicket", (q, a, b) => q.getKitchenTicket(a.storeId, b.orderId)],
    ["listMenuForSettings", (q, a) => q.listMenuForSettings(a.storeId)],
    ["getOpenSessionCount", (q, a) => q.getOpenSessionCount(a.storeId)],
    ["listRoles", (q, a) => q.listRoles(a.storeId)],
    ["listRoleOptions", (q, a) => q.listRoleOptions(a.storeId)],
    ["listTablesForManage", (q, a) => q.listTablesForManage(a.storeId)],
    ["listMenuForManage", (q, a) => q.listMenuForManage(a.storeId)],
    ["listPendingInvites", (q, a) => q.listPendingInvites(a.storeId)],
    ["listSubscriptionHistory", (q, a) => q.listSubscriptionHistory(a.storeId)],
    ["getBillingOverview", (q, a) => q.getBillingOverview(a.storeId)],
    ["getPaymentConfig", (q, a) => q.getPaymentConfig(a.storeId)],
    ["getScbConfig", (q, a) => q.getScbConfig(a.storeId)],
    ["listTablesForPos", (q, a) => q.listTablesForPos(a.storeId)],
    ["listKitchenStations", (q, a) => q.listKitchenStations(a.storeId)],
    ["listTherapists", (q, a) => q.listTherapists(a.storeId)],
    ["listTherapistOptions", (q, a) => q.listTherapistOptions(a.storeId)],
    ["listTherapistShifts", (q, a) => q.listTherapistShifts(a.storeId, businessDayKey(), 7)],
    ["listBookingsForDay", (q, a) => q.listBookingsForDay(a.storeId, addDays(businessDayKey(), 1))],
    ["getBookingDay", (q, a) => q.getBookingDay(a.storeId, addDays(businessDayKey(), 1))],
    ["getSpaBoard", (q, a) => q.getSpaBoard(a.storeId)],
    ["listUpcomingBookings", (q, a) => q.listUpcomingBookings(a.storeId)],
    ["countUpcomingBookings", (q, a) => q.countUpcomingBookings(a.storeId)],
    ["listServicesAwaitingStart", (q, a) => q.listServicesAwaitingStart(a.storeId)],
    ["countServicesAwaitingStart", (q, a) => q.countServicesAwaitingStart(a.storeId)],
    ["getTherapistSalesReport", (q, a) => q.getTherapistSalesReport(a.storeId, { from: addDays(businessDayKey(), -29), to: businessDayKey() })],
    ["getTherapistHistory", (q, a, b) => q.getTherapistHistory(a.storeId, b.therapistId, { from: addDays(businessDayKey(), -29), to: businessDayKey() })],
    ["getTherapistById", (q, a, b) => q.getTherapistById(a.storeId, b.therapistId)],
    // 20e — รายงานแยกประเภท + ตารางพนักงาน × วัน + CSV (raw SQL ทุกตัว ต้องกรอง storeId เอง)
    ["getTherapistDailyMatrix", (q, a) => q.getTherapistDailyMatrix(a.storeId, { from: addDays(businessDayKey(), -29), to: businessDayKey() })],
    ["getSalesByKind", (q, a) => q.getSalesByKind(a.storeId, { from: addDays(businessDayKey(), -29), to: businessDayKey() })],
    ["getTopItemsByKind", (q, a) => q.getTopItemsByKind(a.storeId, { from: addDays(businessDayKey(), -29), to: businessDayKey() }, "PRODUCT")],
    ["listSalesForExport", (q, a) => q.listSalesForExport(a.storeId, { from: addDays(businessDayKey(), -29), to: businessDayKey() }, null)],
    ["getPaymentBreakdown", (q, a) => q.getPaymentBreakdown(a.storeId, { from: addDays(businessDayKey(), -29), to: businessDayKey() })],
  ]

  describe("lib/queries.ts — อ่านใต้ร้าน A ต้องไม่เห็นอะไรของร้าน B", () => {
    it("ทุกฟังก์ชันที่ export ถูกใส่ในตารางเทสแล้ว (เพิ่ม query ใหม่ต้องเพิ่มที่นี่ด้วย)", () => {
      const exported = Object.entries(queries)
        .filter(([, value]) => typeof value === "function")
        .map(([name]) => name)
      const covered = new Set([...QUERY_CASES.map(([name]) => name), ...TOKEN_SCOPED_QUERIES])
      const missing = exported.filter((name) => !covered.has(name))
      expect(missing).toEqual([])
    })

    it.each(QUERY_CASES)("%s", async (_name, run) => {
      const result = await run(queries, A, B)
      expectNoLeak(result, B)
    })

    it("ผลลัพธ์ใต้ร้าน A ยังเห็นข้อมูลของ A เอง (ไม่ใช่กรองจนว่างเปล่า)", async () => {
      expect((await queries.listProducts(A.storeId)).map((p) => p.id)).toEqual([A.productId])
      expect((await queries.listSales(A.storeId, {})).map((s) => s.id)).toEqual([A.saleId])
      expect((await queries.listTableOverview(A.storeId)).map((t) => t.id).sort()).toEqual(
        [A.tableId, A.table2Id, A.roomId].sort(),
      )
      expect((await queries.listNotifications(A.storeId)).map((n) => n.id)).toEqual([A.notificationId])
      expect((await queries.listPaymentsAwaitingCallback(A.storeId)).map((p) => p.ref1)).toEqual([A.intentRef1])
      expect((await queries.listRoles(A.storeId)).some((r) => r.id === A.roleId)).toBe(true)
      expect((await queries.listUsers(A.storeId)).map((u) => u.id).sort()).toEqual([A.ownerId, A.staffId].sort())
      expect(await queries.getSaleById(A.storeId, A.saleId)).not.toBeNull()
      expect(await queries.getTableDetail(A.storeId, A.tableId)).not.toBeNull()
      expect(await queries.getKitchenTicket(A.storeId, A.orderId)).not.toBeNull()
    })

    it("queries ฝั่งลูกค้า (qrToken) ชี้ไปร้านของ token นั้นเท่านั้น", async () => {
      const sessionB = await queries.resolveCustomerSession(B.qrToken)
      expectNoLeak(sessionB, A)
      const statusB = await queries.getCustomerPaymentStatus(B.qrToken)
      expectNoLeak(statusB, A)
    })
  })

  // ───────────────────── 2. Server Actions ─────────────────────

  /// action ที่ไม่รับ id ของข้อมูลร้าน หรือเป็นของ "ตัวผู้ใช้"/ลูกค้า (ร้านมาจาก qrToken) — ไม่อยู่ในตาราง
  const ACTIONS_WITHOUT_FOREIGN_ID = [
    "closeCashierDay",
    "acknowledgeAllNotifications",
    "generateMissingQRCodes",
    "createTable",
    "createTablesBulk",
    // Phase 20b: คัดลอกกะรับแค่คีย์วัน (ไม่มี id ของข้อมูล) — ขอบเขตร้านมาจาก forStore() ล้วน
    "copyShifts",
    "createRole",
    "createCategory",
    "updateStoreSettings",
    "updateProfile",
    "switchActiveStore",
    // Phase 14a: สร้างร้านใหม่ (ยังไม่มีร้าน) · เชิญด้วยอีเมล (ไม่ใช่ id) · ตอบรับด้วย token ของตัวเอง
    // · ผู้ดูแลแพลตฟอร์มทำงานข้ามร้านโดยตั้งใจ (เทสแยกที่ platform-admin.test.ts)
    "createStore",
    "inviteMember",
    "acceptInvite",
    "setStoreStatus",
    // Phase 14b: ฝั่งร้านไม่รับ id ของข้อมูลร้าน (แพ็กเกจเป็นของแพลตฟอร์ม) · ฝั่งแพลตฟอร์มทำงานข้ามร้านโดยตั้งใจ
    // (เทสสิทธิ์อยู่ที่ billing.test.ts — ผู้ที่ไม่ใช่ admin ถูกปฏิเสธทุกตัว)
    "claimTrial",
    "requestRenewal",
    "requestUpgrade",
    "confirmSubscription",
    "voidSubscription",
    "grantCustomDays",
    "setTableLimit",
    "publishPlanVersion",
    "retirePlan",
    // ฝั่งลูกค้า: ร้านมาจาก qrToken เสมอ — ทดสอบแยกด้านล่าง
    "submitOrder",
    "callStaff",
    "requestBill",
    "registerMember",
    "startCustomerPayment",
    // Phase 15b: ลูกค้าแนบสลิป — ร้านมาจาก qrToken เช่นกัน (เทสอยู่ที่ payment-slip.test.ts)
    "submitPaymentSlip",
    // Phase 14c: ขอบเขตคือ brand.ownerId ไม่ใช่ storeId (เทสสิทธิ์ข้ามแบรนด์อยู่ที่ brand.test.ts) ·
    // ฝั่งแพลตฟอร์มทำงานข้ามร้านโดยตั้งใจ
    "renameBrand",
    "cancelBrandBatch",
    "confirmSubscriptionBatch",
    "voidSubscriptionBatch",
    // Phase 15a: ตั้งค่ารับเงินของร้านที่ทำงานอยู่ (ไม่รับ id) · ผู้ดูแลแพลตฟอร์มตั้งโหมดข้ามร้านโดยตั้งใจ
    // (เทสสิทธิ์/แยกร้านอยู่ที่ payment-config.test.ts)
    "updatePaymentConfig",
    "setStorePaymentMode",
    // Phase 15c: SCB ของร้านที่ทำงานอยู่ (ไม่รับ id) — เทสอยู่ที่ payment-scb-store.test.ts
    "updateScbCredentials",
    "clearScbCredentials",
    "startScbConnectionTest",
    "getScbTestStatus",
    // Phase 17a: อัปโหลดรูปเข้าร้านที่ทำงานอยู่เสมอ (ไม่รับ id ของร้านอื่น)
    "uploadStoreAsset",
    // Phase 17c: ขายกลับบ้านไม่มีโต๊ะ — id เดียวที่รับคือ menuItemId ซึ่งถูกกรองด้วย forStore() อยู่แล้ว
    // (เมนูของร้านอื่น → buildOrderLines หาไม่เจอ → ปฏิเสธ · เทสอยู่ที่ takeaway-sale.test.ts)
    "createTakeawaySale",
    // QR พร้อมเพย์ของร้านที่ทำงานอยู่ — รับแค่ยอดเงิน ไม่รับ id (เทสอยู่ที่ takeaway-sale.test.ts)
    "buildStorePromptPayQr",
  ]

  type ActionCase = [
    name: string,
    form: (b: StoreFixture, a: StoreFixture) => FormData,
    untouched: (b: StoreFixture) => Promise<void>,
  ]
  const ACTION_CASES: ActionCase[] = [
    [
      "updateCategory",
      (b) => makeFormData({ id: b.categoryId, name: "ถูกร้าน A แก้" }),
      async (b) => expect((await testPrisma().category.findUniqueOrThrow({ where: { id: b.categoryId } })).name).toBe("หมวดร้าน B"),
    ],
    [
      "deleteCategory",
      (b) => makeFormData({ id: b.categoryId }),
      async (b) => expect(await testPrisma().category.count({ where: { id: b.categoryId } })).toBe(1),
    ],
    [
      "createProduct",
      (b) => makeFormData({ name: "สินค้าใหม่", sku: "", categoryId: b.categoryId, unit: "ชิ้น", price: "10", reorderPoint: "0" }),
      async (b) => expect(await testPrisma().product.count({ where: { categoryId: b.categoryId } })).toBe(1),
    ],
    [
      "updateProduct",
      (b) => makeFormData({ id: b.productId, name: "ถูกร้าน A แก้", sku: "SKU-B-1", categoryId: b.categoryId, unit: "ชิ้น", price: "10", reorderPoint: "0" }),
      async (b) => expect((await testPrisma().product.findUniqueOrThrow({ where: { id: b.productId } })).name).toBe("สินค้าร้าน B"),
    ],
    [
      "deleteProduct",
      (b) => makeFormData({ id: b.productId }),
      async (b) => expect(await testPrisma().product.count({ where: { id: b.productId } })).toBe(1),
    ],
    [
      "stockIn",
      (b) => makeFormData({ productId: b.productId, quantity: 5, note: "" }),
      async (b) => expect((await testPrisma().product.findUniqueOrThrow({ where: { id: b.productId } })).quantity).toBe(10),
    ],
    [
      "stockOut",
      (b) => makeFormData({ productId: b.productId, quantity: 1, note: "" }),
      async (b) => expect((await testPrisma().product.findUniqueOrThrow({ where: { id: b.productId } })).quantity).toBe(10),
    ],
    [
      "createSale",
      (b) => makeFormData({ items: JSON.stringify([{ productId: b.productId, quantity: 1 }]), discount: "0", paymentMethod: "CASH", amountReceived: "50", note: "" }),
      async (b) => {
        expect((await testPrisma().product.findUniqueOrThrow({ where: { id: b.productId } })).quantity).toBe(10)
        expect(await testPrisma().sale.count({ where: { items: { some: { productId: b.productId } } } })).toBe(1)
      },
    ],
    [
      "voidSale",
      (b) => makeFormData({ id: b.saleId, reason: "ร้าน A พยายาม void" }),
      async (b) => expect((await testPrisma().sale.findUniqueOrThrow({ where: { id: b.saleId } })).status).toBe("COMPLETED"),
    ],
    [
      "saveMenuItem",
      (b) => makeFormData({ id: b.menuItemId, name: "ถูกร้าน A แก้", price: "1", imageUrl: "", isActive: "true", modifierGroups: "[]" }),
      async (b) => expect((await testPrisma().menuItem.findUniqueOrThrow({ where: { id: b.menuItemId } })).name).toBe("เมนูร้าน B"),
    ],
    [
      "deleteMenuItem",
      (b) => makeFormData({ id: b.menuItemId }),
      async (b) => expect(await testPrisma().menuItem.count({ where: { id: b.menuItemId } })).toBe(1),
    ],
    // Phase 19 — ประเภทครัว: แก้/ลบด้วย id ของร้าน B ต้องไม่ถึง · FK stationId ของร้าน B ในฟอร์มเมนูของ A ต้องถูกปฏิเสธ
    [
      "saveKitchenStation",
      (b) => makeFormData({ id: b.stationId, name: "ถูกร้าน A แก้", sortOrder: "0" }),
      async (b) => expect((await testPrisma().kitchenStation.findUniqueOrThrow({ where: { id: b.stationId } })).name).toBe(`ครัวร้าน ${b.tag}`),
    ],
    [
      "deleteKitchenStation",
      (b) => makeFormData({ id: b.stationId }),
      async (b) => expect(await testPrisma().kitchenStation.count({ where: { id: b.stationId } })).toBe(1),
    ],
    // Phase 20 — พนักงานนวด: แก้/ปิด/ลบด้วย id ของร้าน B ต้องไม่ถึง · มอบหมาย/เริ่มนวดบรรทัดบริการของ B ต้องไม่ถึง
    [
      "saveTherapist",
      (b) => makeFormData({ id: b.therapistId, code: "HACK", name: "ถูกร้าน A แก้", isActive: "true", skillIds: "" }),
      async (b) => expect((await testPrisma().therapist.findUniqueOrThrow({ where: { id: b.therapistId } })).code).toBe(`T${b.tag}`),
    ],
    [
      "toggleTherapistActive",
      (b) => makeFormData({ id: b.therapistId }),
      async (b) => expect((await testPrisma().therapist.findUniqueOrThrow({ where: { id: b.therapistId } })).isActive).toBe(true),
    ],
    [
      "deleteTherapist",
      (b) => makeFormData({ id: b.therapistId }),
      async (b) => expect(await testPrisma().therapist.count({ where: { id: b.therapistId } })).toBe(1),
    ],
    [
      "assignOrderItemTherapist",
      (b, a) => makeFormData({ id: b.serviceItemId, therapistId: a.therapistId }),
      async (b) => expect((await testPrisma().mobileOrderItem.findUniqueOrThrow({ where: { id: b.serviceItemId } })).therapistId).toBe(b.therapistId),
    ],
    [
      "startServiceItem",
      (b) => makeFormData({ id: b.serviceItemId }),
      async (b) => expect((await testPrisma().mobileOrderItem.findUniqueOrThrow({ where: { id: b.serviceItemId } })).status).toBe("AWAITING_KITCHEN"),
    ],
    [
      "toggleMenuItemActive",
      (b) => makeFormData({ id: b.menuItemId }),
      async (b) => expect((await testPrisma().menuItem.findUniqueOrThrow({ where: { id: b.menuItemId } })).isActive).toBe(true),
    ],
    [
      "setFeaturedMenu",
      (b) => makeFormData({ menuItemIds: b.menuItemId }),
      async (b) => {
        expect((await testPrisma().menuItem.findUniqueOrThrow({ where: { id: b.menuItemId } })).isFeatured).toBe(true)
        // เมนูแนะนำของ A ต้องไม่ถูกล้างจากคำขอที่ล้มเหลว
        expect((await testPrisma().menuItem.findUniqueOrThrow({ where: { id: A.menuItemId } })).isFeatured).toBe(true)
      },
    ],
    [
      "acknowledgeNotification",
      (b) => makeFormData({ id: b.notificationId }),
      async (b) => expect((await testPrisma().notification.findUniqueOrThrow({ where: { id: b.notificationId } })).status).toBe("PENDING"),
    ],
    [
      "startCookingItem",
      (b) => makeFormData({ id: b.orderItemId }),
      async (b) => expect((await testPrisma().mobileOrderItem.findUniqueOrThrow({ where: { id: b.orderItemId } })).status).toBe("AWAITING_KITCHEN"),
    ],
    [
      "markItemReady",
      (b) => makeFormData({ id: b.orderItemId }),
      async (b) => expect((await testPrisma().mobileOrderItem.findUniqueOrThrow({ where: { id: b.orderItemId } })).status).toBe("AWAITING_KITCHEN"),
    ],
    [
      "markItemServed",
      (b) => makeFormData({ id: b.orderItemId }),
      async (b) => expect((await testPrisma().mobileOrderItem.findUniqueOrThrow({ where: { id: b.orderItemId } })).status).toBe("AWAITING_KITCHEN"),
    ],
    [
      "reduceOrderItemQuantity",
      (b) => makeFormData({ id: b.orderItemId, quantity: "1" }),
      async (b) => expect((await testPrisma().mobileOrderItem.findUniqueOrThrow({ where: { id: b.orderItemId } })).status).toBe("AWAITING_KITCHEN"),
    ],
    [
      "cancelOrderItem",
      (b) => makeFormData({ id: b.orderItemId, reason: "ร้าน A พยายามยกเลิก" }),
      async (b) => expect((await testPrisma().mobileOrderItem.findUniqueOrThrow({ where: { id: b.orderItemId } })).status).toBe("AWAITING_KITCHEN"),
    ],
    [
      "startCookingOrder",
      (b) => makeFormData({ id: b.orderId }),
      async (b) => expect((await testPrisma().mobileOrderItem.findUniqueOrThrow({ where: { id: b.orderItemId } })).status).toBe("AWAITING_KITCHEN"),
    ],
    [
      "markOrderReady",
      (b) => makeFormData({ id: b.orderId }),
      async (b) => expect((await testPrisma().mobileOrderItem.findUniqueOrThrow({ where: { id: b.orderItemId } })).status).toBe("AWAITING_KITCHEN"),
    ],
    [
      "markOrderServed",
      (b) => makeFormData({ id: b.orderId }),
      async (b) => expect((await testPrisma().mobileOrderItem.findUniqueOrThrow({ where: { id: b.orderItemId } })).status).toBe("AWAITING_KITCHEN"),
    ],
    [
      "reprintKitchenTicket",
      (b) => makeFormData({ id: b.orderId }),
      async (b) => expect((await testPrisma().mobileOrder.findUniqueOrThrow({ where: { id: b.orderId } })).printedAt).toBeNull(),
    ],
    [
      "markTicketPrinted",
      (b) => makeFormData({ id: b.orderId }),
      async (b) => expect((await testPrisma().mobileOrder.findUniqueOrThrow({ where: { id: b.orderId } })).printedAt).toBeNull(),
    ],
    [
      "confirmMobilePayment",
      (b) => makeFormData({ sessionId: b.sessionId, paymentMethod: "CASH", amountReceived: "80" }),
      async (b) => {
        expect((await testPrisma().tableSession.findUniqueOrThrow({ where: { id: b.sessionId } })).status).toBe("OPEN")
        expect(await testPrisma().sale.count({ where: { tableSessionId: b.sessionId } })).toBe(0)
      },
    ],
    // 20f — ออก QR พร้อมเพย์ให้บิลของร้าน B ต้องไม่ได้ (มีแค่ intent ใบเดียวจาก fixture · ไม่มีใบใหม่/ไม่ถูกทำ EXPIRED)
    [
      "prepareStaffPromptPay",
      (b) => makeFormData({ sessionId: b.sessionId }),
      async (b) => {
        const intents = await testPrisma().paymentIntent.findMany({ where: { tableSessionId: b.sessionId }, select: { id: true, status: true } })
        expect(intents.map((i) => i.id)).toEqual([b.intentId])
        expect(intents[0].status).toBe("PENDING")
      },
    ],
    [
      "getStaffBillStatus",
      (b) => makeFormData({ sessionId: b.sessionId }),
      async (b) => expect((await testPrisma().tableSession.findUniqueOrThrow({ where: { id: b.sessionId } })).status).toBe("OPEN"),
    ],
    [
      "generateQRCode",
      (b) => makeFormData({ tableId: b.table2Id, type: "STATIC" }),
      async (b) => expect(await testPrisma().qRCode.count({ where: { tableId: b.table2Id } })).toBe(1),
    ],
    [
      "invalidateQRCode",
      (b) => makeFormData({ id: b.qrId }),
      async (b) => expect((await testPrisma().qRCode.findUniqueOrThrow({ where: { id: b.qrId } })).status).toBe("ACTIVE"),
    ],
    [
      "reprintQRCode",
      (b) => makeFormData({ id: b.qrId }),
      async (b) => {
        const qr = await testPrisma().qRCode.findUniqueOrThrow({ where: { id: b.qrId } })
        expect(qr.issuedAt.getTime()).toBe(qr.createdAt.getTime())
      },
    ],
    [
      "updateRole",
      (b) => makeFormData({ id: b.roleId, name: "ถูกร้าน A แก้", permissions: "[]" }),
      async (b) => expect((await testPrisma().role.findUniqueOrThrow({ where: { id: b.roleId } })).name).toBe("บทบาทร้าน B"),
    ],
    [
      "deleteRole",
      (b) => makeFormData({ id: b.roleId }),
      async (b) => expect(await testPrisma().role.count({ where: { id: b.roleId } })).toBe(1),
    ],
    [
      "assignUserRole",
      (b, a) => makeFormData({ userId: b.staffId, roleId: a.roleId }),
      async (b) =>
        expect(
          (await testPrisma().storeMember.findUniqueOrThrow({ where: { userId_storeId: { userId: b.staffId, storeId: b.storeId } } })).roleId,
        ).toBeNull(),
    ],
    [
      "setStoreMemberRole",
      (b) => makeFormData({ userId: b.staffId, role: "OWNER" }),
      async (b) =>
        expect(
          (await testPrisma().storeMember.findUniqueOrThrow({ where: { userId_storeId: { userId: b.staffId, storeId: b.storeId } } })).role,
        ).toBe("STAFF"),
    ],
    [
      "removeStoreMember",
      (b) => makeFormData({ userId: b.staffId }),
      async (b) =>
        expect(await testPrisma().storeMember.count({ where: { userId: b.staffId, storeId: b.storeId } })).toBe(1),
    ],
    [
      "openTableSession",
      (b) => makeFormData({ tableId: b.table2Id }),
      async (b) => {
        expect(await testPrisma().tableSession.count({ where: { tableId: b.table2Id } })).toBe(0)
        expect((await testPrisma().table.findUniqueOrThrow({ where: { id: b.table2Id } })).status).toBe("EMPTY")
      },
    ],
    [
      "mergeTables",
      (b, a) => makeFormData({ primaryTableId: a.tableId, secondaryTableId: b.table2Id }),
      async (b) => expect((await testPrisma().table.findUniqueOrThrow({ where: { id: b.table2Id } })).primaryTableId).toBeNull(),
    ],
    [
      "unmergeTables",
      (b) => makeFormData({ secondaryTableId: b.tableId }),
      async (b) => expect((await testPrisma().table.findUniqueOrThrow({ where: { id: b.tableId } })).status).toBe("ORDERED"),
    ],
    [
      "cancelTableSession",
      (b) => makeFormData({ sessionId: b.sessionId, reason: "ร้าน A พยายามยกเลิก" }),
      async (b) => expect((await testPrisma().tableSession.findUniqueOrThrow({ where: { id: b.sessionId } })).status).toBe("OPEN"),
    ],
    [
      "renameTable",
      (b) => makeFormData({ id: b.table2Id, code: "ZZ" }),
      async (b) => expect((await testPrisma().table.findUniqueOrThrow({ where: { id: b.table2Id } })).code).toBe("TB2"),
    ],
    [
      "deleteTable",
      (b) => makeFormData({ id: b.table2Id }),
      async (b) => expect(await testPrisma().table.count({ where: { id: b.table2Id } })).toBe(1),
    ],
    [
      "revokeInvite",
      (b) => makeFormData({ id: b.inviteId }),
      async (b) => expect((await testPrisma().storeInvite.findUniqueOrThrow({ where: { id: b.inviteId } })).revokedAt).toBeNull(),
    ],
    // Phase 14c — ร้าน B ต้องดึงเข้าแบรนด์ของ A / ถูกคัดลอกเมนู / ถูกใส่ในใบจ่ายรวมของ A ไม่ได้
    [
      "createBrand",
      (b) => {
        const fd = makeFormData({ name: "แบรนด์ของ A" })
        fd.append("storeIds", b.storeId)
        return fd
      },
      async (b) => {
        expect((await testPrisma().store.findUniqueOrThrow({ where: { id: b.storeId } })).brandId).toBeNull()
        expect(await testPrisma().brand.count()).toBe(0)
      },
    ],
    [
      "attachStoreToBrand",
      (b) => makeFormData({ storeId: b.storeId }),
      async (b) => expect((await testPrisma().store.findUniqueOrThrow({ where: { id: b.storeId } })).brandId).toBeNull(),
    ],
    [
      "copyMenuFromStore",
      (b) => makeFormData({ sourceStoreId: b.storeId }),
      // B มีเมนู 2 รายการตั้งแต่ seed (อาหาร 1 + โปรแกรมนวดปิดขาย 1 — Phase 20) ต้องไม่เพิ่ม/ลดจากคำขอที่ล้ม
      async (b) => expect(await testPrisma().menuItem.count({ where: { storeId: b.storeId } })).toBe(2),
    ],
    [
      "requestBrandBatch",
      (b) => {
        const fd = new FormData()
        fd.append("item", `${b.storeId}|S-D7`)
        return fd
      },
      async (b) => expect(await testPrisma().storeSubscription.count({ where: { storeId: b.storeId, batchId: { not: null } } })).toBe(0),
    ],
    [
      "createStaffTableOrder",
      (b, a) => {
        const fd = new FormData()
        fd.set("tableId", b.tableId)
        fd.set("items", JSON.stringify([{ menuItemId: a.menuItemId, quantity: 1, optionIds: [] }]))
        return fd
      },
      async (b) => expect(await testPrisma().mobileOrder.count({ where: { storeId: b.storeId } })).toBe(1),
    ],
    // Phase 20b — คิวจอง/กะของร้าน B: แก้ · ยกเลิก · เช็กอิน · ตั้งกะ ด้วย id ของร้าน B ต้องไม่ถึง
    [
      "saveBooking",
      (b) =>
        makeFormData({
          id: b.bookingId,
          customerName: "ถูกร้าน A แก้",
          menuItemId: b.menuItemId,
          therapistId: b.therapistId,
          bookingDate: addDays(businessDayKey(), 1),
          startTime: "15:00",
        }),
      async (b) => expect((await testPrisma().booking.findUniqueOrThrow({ where: { id: b.bookingId } })).customerName).toBe(b.bookingCustomer),
    ],
    [
      "cancelBooking",
      (b) => makeFormData({ id: b.bookingId }),
      async (b) => expect((await testPrisma().booking.findUniqueOrThrow({ where: { id: b.bookingId } })).status).toBe("BOOKED"),
    ],
    [
      "markBookingNoShow",
      (b) => makeFormData({ id: b.bookingId }),
      async (b) => expect((await testPrisma().booking.findUniqueOrThrow({ where: { id: b.bookingId } })).status).toBe("BOOKED"),
    ],
    [
      "checkInBooking",
      (b) => makeFormData({ id: b.bookingId, tableId: b.roomId }),
      async (b) => expect((await testPrisma().booking.findUniqueOrThrow({ where: { id: b.bookingId } })).status).toBe("BOOKED"),
    ],
    [
      "saveShift",
      (b) => makeFormData({ therapistId: b.therapistId, workDate: businessDayKey(), startTime: "01:00", endTime: "02:00", isOff: "false" }),
      async (b) =>
        expect(
          (await testPrisma().therapistShift.findFirstOrThrow({ where: { therapistId: b.therapistId } })).startMinute,
        ).toBe(8 * 60),
    ],
    [
      "deleteShift",
      (b) => makeFormData({ therapistId: b.therapistId, workDate: businessDayKey() }),
      async (b) => expect(await testPrisma().therapistShift.count({ where: { therapistId: b.therapistId } })).toBe(1),
    ],
    [
      "deleteStoreAsset",
      (b) => makeFormData({ url: `/api/assets/${b.assetId}` }),
      async (b) => expect(await testPrisma().storeAsset.findUnique({ where: { id: b.assetId } })).not.toBeNull(),
    ],
    [
      "cancelPendingRequest",
      (b) => makeFormData({ id: b.subscriptionId }),
      async (b) => expect((await testPrisma().storeSubscription.findUniqueOrThrow({ where: { id: b.subscriptionId } })).status).toBe("PENDING"),
    ],
  ]

  describe("Server Action — ยิงด้วย id ของร้าน B ใต้ร้าน A ต้อง ok:false และ B ต้องไม่ถูกแตะ", () => {
    it("ทุก action ที่ export ถูกใส่ในตารางเทสแล้ว (เพิ่ม action ใหม่ต้องเพิ่มที่นี่ด้วย)", () => {
      const exported = Object.entries(actions)
        .filter(([, value]) => typeof value === "function")
        .map(([name]) => name)
      const covered = new Set([...ACTION_CASES.map(([name]) => name), ...ACTIONS_WITHOUT_FOREIGN_ID])
      const missing = exported.filter((name) => !covered.has(name))
      expect(missing).toEqual([])
      // กันชื่อในตารางสะกดผิดจนไม่เคยถูกเรียก
      for (const [name] of ACTION_CASES) expect(typeof actions[name], name).toBe("function")
    })

    it.each(ACTION_CASES)("%s", async (name, form, untouched) => {
      const result = await actions[name](form(B, A))
      expect(result.ok, `${name} ต้องล้มเหลวเมื่อได้ id ของร้านอื่น`).toBe(false)
      await untouched(B)
    })

    it("acknowledgeAllNotifications ใต้ร้าน A ต้องไม่รับทราบแทนร้าน B", async () => {
      const result = await actions.acknowledgeAllNotifications(makeFormData({}))
      expect(result.ok).toBe(true)
      expect((await testPrisma().notification.findUniqueOrThrow({ where: { id: A.notificationId } })).status).toBe("ACKNOWLEDGED")
      expect((await testPrisma().notification.findUniqueOrThrow({ where: { id: B.notificationId } })).status).toBe("PENDING")
    })

    it("closeCashierDay ใต้ร้าน A นับเฉพาะบิลของ A", async () => {
      const result = await actions.closeCashierDay(makeFormData({ countedCash: "0", note: "" }))
      expect(result.ok).toBe(true)
      const closing = await testPrisma().cashierClosing.findFirst({
        where: { storeId: A.storeId, cashierId: A.ownerId },
        orderBy: { closedAt: "desc" },
      })
      // บิลใน seed ถูกสร้าง "วันนี้" ทั้งสองร้าน — ต้องเห็นแค่ของ A (1 บิล 100 บาท)
      expect(closing?.billCount).toBe(1)
      expect(closing?.totalSales.toString()).toBe("100")
    })

    it("saveMenuItem ใต้ร้าน A ส่ง stationId ของร้าน B มา ต้องถูกปฏิเสธ (FK จากฟอร์ม — กติกาข้อ 5)", async () => {
      const result = await actions.saveMenuItem(
        makeFormData({ name: "เมนูใหม่ของ A", price: "10", imageUrl: "", isActive: "true", modifierGroups: "[]", stationId: B.stationId }),
      )
      expect(result.ok).toBe(false)
      expect(await testPrisma().menuItem.count({ where: { stationId: B.stationId } })).toBe(1)
      // ส่ง station ของตัวเองผ่านตามปกติ
      const ok = await actions.saveMenuItem(
        makeFormData({ name: "เมนูใหม่ของ A", price: "10", imageUrl: "", isActive: "true", modifierGroups: "[]", stationId: A.stationId }),
      )
      expect(ok.ok).toBe(true)
      expect(await testPrisma().menuItem.count({ where: { storeId: A.storeId, stationId: A.stationId } })).toBe(2)
    })

    it("Phase 20: FK ข้ามร้านบนฟอร์ม — therapist ของ B ในตะกร้า A · skill ของ B ให้พนักงาน A · ประเภทห้องของ B ให้ห้อง A ต้องถูกปฏิเสธ", async () => {
      // พนักงานนวดของร้าน B บนบรรทัดโปรแกรมนวดของร้าน A
      const serviceA = await testPrisma().menuItem.create({
        data: { storeId: A.storeId, name: "นวด A", price: "300.00", itemType: "SERVICE", durationMinutes: 60 },
      })
      const order = await actions.createStaffTableOrder(
        makeFormData({ tableId: A.table2Id, items: JSON.stringify([{ menuItemId: serviceA.id, quantity: 1, optionIds: [], therapistId: B.therapistId }]) }),
      )
      expect(order.ok).toBe(false)
      expect(await testPrisma().mobileOrderItem.count({ where: { menuItemId: serviceA.id } })).toBe(0)

      // ทักษะ (ประเภทบริการ) ของร้าน B ให้พนักงานใหม่ของร้าน A
      const th = await actions.saveTherapist(makeFormData({ code: "NEW", name: "คนใหม่ A", isActive: "true", skillIds: B.stationId }))
      expect(th.ok).toBe(false)
      expect(await testPrisma().therapist.count({ where: { storeId: A.storeId, code: "NEW" } })).toBe(0)

      // ประเภทห้องของร้าน B ให้ห้องใหม่ของร้าน A
      const room = await actions.createTable(makeFormData({ code: "R9", kind: "ROOM", stationId: B.stationId }))
      expect(room.ok).toBe(false)
      expect(await testPrisma().table.count({ where: { storeId: A.storeId, code: "R9" } })).toBe(0)
    })

    it("switchActiveStore ไปร้านที่ไม่ได้เป็นสมาชิกต้องถูกปฏิเสธ", async () => {
      const result = await actions.switchActiveStore(makeFormData({ storeId: B.storeId }))
      expect(result.ok).toBe(false)
    })

    it("ผู้ใช้ที่อยู่ทั้งสองร้าน — สลับร้านแล้วเห็นเฉพาะข้อมูลของร้านนั้น", async () => {
      await addTestMember("owner-a", B.storeId, "STAFF")
      setActiveTestStore(B.storeId)
      // อยู่ร้าน B เป็น STAFF ไร้บทบาท → ยกเลิกรายการของ B ไม่ได้เพราะไม่มีสิทธิ์ แต่ต้องไม่ใช่ "ไม่พบ"
      const products = await queries.listProducts(B.storeId)
      expect(products.map((p) => p.id)).toEqual([B.productId])
      expectNoLeak(products, A)
    })
  })

  // ───────────────────── 3. ฝั่งลูกค้าและ webhook — ร้านมาจากค่าที่เดินทางออกนอกระบบ ─────────────────────

  describe("qrToken / ref1 ชี้ร้านของตัวเองเสมอ", () => {
    it("ลูกค้าสั่งอาหารผ่าน QR ของร้าน B ด้วยเมนูของร้าน A ต้องถูกปฏิเสธ", async () => {
      const result = await actions.submitOrder(
        makeFormData({
          qrToken: B.qrToken,
          items: JSON.stringify([{ menuItemId: A.menuItemId, quantity: 1, optionIds: [] }]),
        }),
      )
      expect(result.ok).toBe(false)
      expect(await testPrisma().mobileOrderItem.count({ where: { menuItemId: A.menuItemId } })).toBe(1)
    })

    it("ลูกค้าสั่งอาหารผ่าน QR ของร้าน B ด้วยเมนูของร้าน B ต้องได้ออร์เดอร์ใต้ร้าน B", async () => {
      const result = await actions.submitOrder(
        makeFormData({
          qrToken: B.qrToken,
          items: JSON.stringify([{ menuItemId: B.menuItemId, quantity: 1, optionIds: [] }]),
        }),
      )
      expect(result.ok).toBe(true)
      const orders = await testPrisma().mobileOrder.findMany({ where: { tableSessionId: B.sessionId } })
      expect(orders).toHaveLength(2)
      expect(orders.every((o) => o.storeId === B.storeId)).toBe(true)
    })

    it("สมัครสมาชิกด้วยเบอร์เดียวกันได้ทั้งสองร้าน — แต้มไม่รวมกัน", async () => {
      const db = testPrisma()
      // ปิดบิลโต๊ะ B ก่อน (ฟอร์มสมัครอยู่หน้า pay/success ซึ่งต้องมีบิลแล้ว)
      await db.storeSettings.update({ where: { storeId: A.storeId }, data: { crmEnabled: true } })
      await db.storeSettings.update({ where: { storeId: B.storeId }, data: { crmEnabled: true } })
      const { closeSessionWithPayment } = await import("@/lib/close-session")
      const closedA = await closeSessionWithPayment({ storeId: A.storeId, sessionId: A.sessionId, paymentMethod: "CASH", cashierId: A.ownerId })
      const closedB = await closeSessionWithPayment({ storeId: B.storeId, sessionId: B.sessionId, paymentMethod: "CASH", cashierId: B.ownerId })
      expect(closedA.ok && closedB.ok).toBe(true)

      const phone = "0899999999"
      const inA = await actions.registerMember(makeFormData({ qrToken: A.qrToken, phone }))
      const inB = await actions.registerMember(makeFormData({ qrToken: B.qrToken, phone }))
      expect(inA.ok, JSON.stringify(inA)).toBe(true)
      expect(inB.ok, JSON.stringify(inB)).toBe(true)

      const members = await db.member.findMany({ where: { phone } })
      expect(members.map((m) => m.storeId).sort()).toEqual([A.storeId, B.storeId].sort())
      // บิล 80 บาท → 3 แต้ม (1 แต้ม/25 บาท) แยกกันคนละร้าน
      expect(members.every((m) => m.pointBalance === 3)).toBe(true)
    })

    it("webhook: ref1 ของร้าน A ปิดบิลได้เฉพาะโต๊ะของ A และบิลออกใต้ storeId ของ A", async () => {
      // callback ไม่มี session — ร้านต้องมาจาก ref1 ตัวเดียว (lookup ข้ามร้านโดยตั้งใจ)
      const { findIntentByRef1 } = await import("@/lib/payment-intent")
      const intent = await findIntentByRef1(A.intentRef1)
      expect(intent?.storeId).toBe(A.storeId)
      const { findStoreByPaymentRef1 } = await import("@/lib/store-resolve")
      expect((await findStoreByPaymentRef1(A.intentRef1))?.storeId).toBe(A.storeId)

      inquireMock.mockResolvedValue({
        ok: true,
        data: { transactionId: "SCBTX-A-1", amount: 80, billPaymentRef1: A.intentRef1 },
      })
      const { verifyAndSettleIntent } = await import("@/lib/payment-reconcile")
      const settled = await verifyAndSettleIntent(intent!, "2026-09-15")
      expect(settled.ok, JSON.stringify(settled)).toBe(true)

      const sale = await testPrisma().sale.findUnique({ where: { tableSessionId: A.sessionId } })
      expect(sale?.storeId).toBe(A.storeId)
      expect(sale?.channel).toBe("MOBILE_ORDER")
      expect(sale?.saleNumber).toBe("INV-000002")
      // โต๊ะของ B ต้องยังเปิดอยู่เหมือนเดิม
      expect((await testPrisma().tableSession.findUniqueOrThrow({ where: { id: B.sessionId } })).status).toBe("OPEN")
      expect(await testPrisma().sale.count({ where: { tableSessionId: B.sessionId } })).toBe(0)
    })

    it("webhook: ref1 ของร้าน B ปิดโต๊ะของ B ใต้ storeId ของ B — ไม่ปนกับ A แม้ยอดเท่ากัน", async () => {
      const { findIntentByRef1 } = await import("@/lib/payment-intent")
      const intent = await findIntentByRef1(B.intentRef1)
      expect(intent?.storeId).toBe(B.storeId)

      inquireMock.mockResolvedValue({
        ok: true,
        data: { transactionId: "SCBTX-B-1", amount: 80, billPaymentRef1: B.intentRef1 },
      })
      const { verifyAndSettleIntent } = await import("@/lib/payment-reconcile")
      const settled = await verifyAndSettleIntent(intent!, "2026-09-15")
      expect(settled.ok, JSON.stringify(settled)).toBe(true)

      const sale = await testPrisma().sale.findUnique({ where: { tableSessionId: B.sessionId } })
      expect(sale?.storeId).toBe(B.storeId)
      expect((await testPrisma().tableSession.findUniqueOrThrow({ where: { id: A.sessionId } })).status).toBe("OPEN")
    })
  })

  // ───────────────────── 4. เลขบิลต่อร้าน ─────────────────────

  describe("เลขบิลเรียงต่อเนื่องภายในร้าน", () => {
    it("ร้าน A และ B ออก INV-000002 ได้พร้อมกัน (ต่างร้านไม่ชนกัน)", async () => {
      const { closeSessionWithPayment } = await import("@/lib/close-session")
      const [a, b] = await Promise.all([
        closeSessionWithPayment({ storeId: A.storeId, sessionId: A.sessionId, paymentMethod: "CASH", cashierId: A.ownerId }),
        closeSessionWithPayment({ storeId: B.storeId, sessionId: B.sessionId, paymentMethod: "CASH", cashierId: B.ownerId }),
      ])
      expect(a.ok && b.ok).toBe(true)
      if (a.ok && b.ok) {
        expect(a.saleNumber).toBe("INV-000002")
        expect(b.saleNumber).toBe("INV-000002")
      }
    })

    it("ขายหน้าร้าน 8 บิลพร้อมกันในร้าน A ต้องได้เลขเรียงไม่มีช่องว่าง และไม่กระทบเลขของ B", async () => {
      await testPrisma().product.update({ where: { id: A.productId }, data: { quantity: 100 } })
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          actions.createSale(
            makeFormData({
              items: JSON.stringify([{ productId: A.productId, quantity: 1 }]),
              discount: "0",
              paymentMethod: "CASH",
              amountReceived: "50",
              note: "",
            }),
          ),
        ),
      )
      expect(results.every((r) => r.ok)).toBe(true)

      const numbersA = (await testPrisma().sale.findMany({ where: { storeId: A.storeId }, select: { saleNumber: true } }))
        .map((s) => s.saleNumber)
        .sort()
      expect(numbersA).toEqual(Array.from({ length: 9 }, (_, i) => `INV-${String(i + 1).padStart(6, "0")}`))

      const numbersB = await testPrisma().sale.findMany({ where: { storeId: B.storeId }, select: { saleNumber: true } })
      expect(numbersB.map((s) => s.saleNumber)).toEqual(["INV-000001"])
    })
  })
})
