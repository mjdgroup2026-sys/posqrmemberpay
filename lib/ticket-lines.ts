/// จัดกลุ่มบรรทัดอาหารตาม "ประเภทครัว" (KitchenStation — Phase 19)
///
/// **ที่เดียวที่ตัดสินลำดับ/ชื่อกลุ่ม** — KDS, ทิกเก็ต PDF และเครื่องพิมพ์ ESC/POS ต้องเห็นเหมือนกันเป๊ะ
/// (หลักเดียวกับ lib/order-label.ts) · กลุ่มเรียงตาม `sortOrder` ของ station แล้วชื่อ · รายการที่ไม่ระบุครัว
/// อยู่ท้ายสุดใต้ป้าย "ไม่ระบุครัว" · ลำดับภายในกลุ่มคงตามที่ส่งเข้ามา (เวลาสั่ง)
///
/// ไม่ผูกกับ Prisma/React — เป็นฟังก์ชันล้วนให้เทสได้ตรง ๆ

export const UNASSIGNED_STATION_LABEL = "ไม่ระบุครัว"

export type StationRef = { id: string | null; name: string | null; sortOrder?: number | null }

export type StationGroup<T> = {
  /// null = กลุ่ม "ไม่ระบุครัว"
  stationId: string | null
  stationName: string
  items: T[]
}

export function groupByStation<T extends { stationId: string | null; stationName: string | null }>(
  items: readonly T[],
  /// ลำดับของ station ตามที่ร้านจัดไว้ — ไม่ส่งมา = เรียงตามชื่อ
  order: readonly { id: string; sortOrder: number }[] = [],
): StationGroup<T>[] {
  const rank = new Map(order.map((s) => [s.id, s.sortOrder]))
  const groups = new Map<string | null, StationGroup<T>>()

  for (const item of items) {
    const key = item.stationId
    let group = groups.get(key)
    if (!group) {
      group = { stationId: key, stationName: item.stationName ?? UNASSIGNED_STATION_LABEL, items: [] }
      groups.set(key, group)
    }
    group.items.push(item)
  }

  return [...groups.values()].sort((a, b) => {
    if (a.stationId === null) return 1
    if (b.stationId === null) return -1
    const ra = rank.get(a.stationId)
    const rb = rank.get(b.stationId)
    if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb
    if (ra !== undefined && rb === undefined) return -1
    if (ra === undefined && rb !== undefined) return 1
    return a.stationName.localeCompare(b.stationName, "th")
  })
}

/// มีการแยกครัวจริงไหม — ทุกบรรทัดไม่ระบุครัว = ไม่ต้องพิมพ์หัวกลุ่มให้รก
export function hasStationSplit(groups: readonly StationGroup<unknown>[]): boolean {
  return groups.length > 1 || (groups.length === 1 && groups[0].stationId !== null)
}
