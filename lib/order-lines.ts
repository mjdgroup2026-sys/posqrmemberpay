import "server-only"
import type { StoreTx } from "@/lib/db"
import { toNumber } from "@/lib/format"

/// แปลง "ตะกร้า" เป็นบรรทัดออร์เดอร์พร้อมราคา — ใช้ร่วมกันระหว่างลูกค้าที่สแกน QR สั่งเอง
/// กับพนักงานที่กดสั่งแทนบนจอขาย (Phase 17) · **ห้ามคำนวณราคาซ้ำที่อื่น** ด้วยเหตุผลเดียวกับ
/// `computeBillTotals()` ใน lib/close-session.ts — ตัวเลขบนจอกับตัวเลขในบิลต้องมาจากสูตรเดียวกันเสมอ
///
/// ทุกค่าถูกอ่านใหม่จากฐานในทรานแซคชันเดียวกับการเขียนเสมอ ไม่เชื่อราคาที่ client ส่งมา

export type CartLineInput = { menuItemId: string; quantity: number; optionIds: string[]; note?: string }

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
}

/// ข้อผิดพลาดที่ "ผู้ใช้ต้องเห็นข้อความไทยตรง ๆ" — ผู้เรียกจับแล้วคืนเป็น ActionResult ของตัวเอง
export class OrderLineError extends Error {
  constructor(readonly reason: string) {
    super("ORDER_LINE_ERROR")
  }
}

export async function buildOrderLines(tx: StoreTx, items: CartLineInput[]): Promise<OrderLine[]> {
  const menuItems = await tx.menuItem.findMany({
    where: { id: { in: items.map((i) => i.menuItemId) }, isActive: true },
    include: { modifierGroups: { include: { options: true } }, station: { select: { name: true } } },
  })
  const menuById = new Map(menuItems.map((m) => [m.id, m]))

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

    return {
      menuItemId: menuItem.id,
      menuItemName: menuItem.name,
      stationId: menuItem.stationId,
      stationName: menuItem.station?.name ?? null,
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
