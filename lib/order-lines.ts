import "server-only"
import type { StoreTx } from "@/lib/db"
import { toNumber } from "@/lib/format"

/// แปลง "ตะกร้า" เป็นบรรทัดออร์เดอร์พร้อมราคา — ใช้ร่วมกันระหว่างลูกค้าที่สแกน QR สั่งเอง
/// กับพนักงานที่กดสั่งแทนบนจอขาย (Phase 17) · **ห้ามคำนวณราคาซ้ำที่อื่น** ด้วยเหตุผลเดียวกับ
/// `computeBillTotals()` ใน lib/close-session.ts — ตัวเลขบนจอกับตัวเลขในบิลต้องมาจากสูตรเดียวกันเสมอ
///
/// ทุกค่าถูกอ่านใหม่จากฐานในทรานแซคชันเดียวกับการเขียนเสมอ ไม่เชื่อราคาที่ client ส่งมา

export type CartLineInput = { menuItemId: string; quantity: number; optionIds: string[]; note?: string; therapistId?: string }

export type OrderLine = {
  menuItemId: string
  menuItemName: string
  quantity: number
  /// ราคาต่อหน่วยรวม modifier แล้ว — snapshot ลง MobileOrderItem/SaleItem กันแก้ราคาเมนูย้อนหลังแล้วบิลเก่าเพี้ยน
  unitPrice: number
  note: string | null
  options: { groupName: string; optionName: string; priceDelta: number }[]
  /// ประเภทครัวของเมนู ณ ตอนสั่ง (Phase 19) — ให้ทิกเก็ตครัวจัดกลุ่มได้ทันทีหลัง commit ไม่ต้องอ่านซ้ำ
  stationId: string | null
  stationName: string | null
  /// Phase 20 — ชนิดรายการ + ระยะเวลา (SERVICE) + พนักงานนวดที่เลือก (null = ยังไม่มอบหมาย)
  itemType: "FOOD" | "SERVICE"
  durationMinutes: number | null
  therapistId: string | null
  therapistLabel: string | null
}

/// ข้อผิดพลาดที่ "ผู้ใช้ต้องเห็นข้อความไทยตรง ๆ" — ผู้เรียกจับแล้วคืนเป็น ActionResult ของตัวเอง
export class OrderLineError extends Error {
  constructor(readonly reason: string) {
    super("ORDER_LINE_ERROR")
  }
}

export async function buildOrderLines(
  tx: StoreTx,
  items: CartLineInput[],
  /// Phase 20 — บังคับให้บรรทัด SERVICE ต้องมีพนักงานนวด (จอขายพนักงาน) · ฝั่งลูกค้าไม่บังคับ (มอบหมายทีหลัง)
  options: { requireTherapistForService?: boolean } = {},
): Promise<OrderLine[]> {
  const menuItems = await tx.menuItem.findMany({
    where: { id: { in: items.map((i) => i.menuItemId) }, isActive: true },
    include: { modifierGroups: { include: { options: true } }, station: { select: { name: true } } },
  })
  const menuById = new Map(menuItems.map((m) => [m.id, m]))

  // พนักงานนวดที่ถูกอ้างถึง — อ่านใต้ร้านเดียวกัน (forStore) id ของร้านอื่นจึงหาไม่เจอ = ปฏิเสธ (กติกาข้อ 5)
  const therapistIds = [...new Set(items.flatMap((i) => (i.therapistId ? [i.therapistId] : [])))]
  const therapists = therapistIds.length
    ? await tx.therapist.findMany({
        where: { id: { in: therapistIds }, isActive: true },
        select: { id: true, code: true, name: true, nickname: true, skills: { select: { id: true } } },
      })
    : []
  const therapistById = new Map(therapists.map((t) => [t.id, t]))

  return items.map((line) => {
    const menuItem = menuById.get(line.menuItemId)
    if (!menuItem) throw new OrderLineError("มีเมนูบางรายการปิดขายไปแล้ว กรุณาตรวจตะกร้าอีกครั้ง")

    const optionById = new Map(
      menuItem.modifierGroups.flatMap((group) => group.options.map((option) => [option.id, { option, group }] as const)),
    )

    const chosen = line.optionIds.map((id) => {
      const found = optionById.get(id)
      if (!found) throw new OrderLineError(`ตัวเลือกของ ${menuItem.name} ไม่ถูกต้อง กรุณาเลือกใหม่`)
      return found
    })

    // กลุ่มที่บังคับเลือกต้องมีอย่างน้อย 1 ตัวเลือกเสมอ — ตรวจซ้ำฝั่ง server ไม่เชื่อ UI
    for (const group of menuItem.modifierGroups) {
      if (!group.required) continue
      const picked = chosen.filter((c) => c.group.id === group.id)
      if (picked.length === 0) throw new OrderLineError(`กรุณาเลือก "${group.name}" ของ ${menuItem.name}`)
      if (group.selectionType === "SINGLE" && picked.length > 1) {
        throw new OrderLineError(`"${group.name}" ของ ${menuItem.name} เลือกได้อย่างเดียว`)
      }
    }

    const basePrice = toNumber(menuItem.price)
    const extra = chosen.reduce((sum, c) => sum + toNumber(c.option.priceDelta), 0)
    const unitPrice = Math.round((basePrice + extra + Number.EPSILON) * 100) / 100

    // พนักงานนวด (Phase 20) — ใส่ได้เฉพาะบรรทัดบริการ · ต้องเป็นของร้าน ยังทำงานอยู่ และมีทักษะตรงประเภทบริการ (ถ้าโปรแกรมระบุประเภท)
    let therapist: (typeof therapists)[number] | null = null
    if (line.therapistId) {
      if (menuItem.itemType !== "SERVICE") throw new OrderLineError(`${menuItem.name} ไม่ใช่โปรแกรมนวด ระบุพนักงานนวดไม่ได้`)
      therapist = therapistById.get(line.therapistId) ?? null
      if (!therapist) throw new OrderLineError(`ไม่พบพนักงานนวดที่เลือกให้ ${menuItem.name} หรือพนักงานคนนั้นปิดใช้งานแล้ว`)
      if (menuItem.stationId && !therapist.skills.some((s) => s.id === menuItem.stationId)) {
        throw new OrderLineError(`พนักงาน ${therapist.code} ไม่มีทักษะ "${menuItem.station?.name ?? ""}" สำหรับ ${menuItem.name}`)
      }
    } else if (menuItem.itemType === "SERVICE" && options.requireTherapistForService) {
      throw new OrderLineError(`กรุณาเลือกพนักงานนวดสำหรับ ${menuItem.name}`)
    }

    return {
      menuItemId: menuItem.id,
      menuItemName: menuItem.name,
      stationId: menuItem.stationId,
      stationName: menuItem.station?.name ?? null,
      itemType: menuItem.itemType,
      durationMinutes: menuItem.durationMinutes,
      therapistId: therapist?.id ?? null,
      therapistLabel: therapist ? `${therapist.code} ${therapist.nickname ?? therapist.name}` : null,
      quantity: line.quantity,
      unitPrice,
      note: line.note ?? null,
      options: chosen.map((c) => ({
        groupName: c.group.name,
        optionName: c.option.name,
        priceDelta: toNumber(c.option.priceDelta),
      })),
    }
  })
}
