import type { Prisma } from "@/generated/prisma/client"

/// คัดลอกเมนูข้ามสาขา (Phase 14c) — สำเนา**อิสระ**: MenuItem + ModifierGroup/ModifierOption ได้ id ใหม่ทั้งหมด
/// แต่ละสาขาแก้ราคา/ซ่อนรายการ/เพิ่มเมนูเฉพาะสาขาได้เองโดยไม่กระทบต้นทาง (ไม่มี "เมนูกลาง sync" ในเฟสนี้)
///
/// ผู้เรียกต้องพิสูจน์แล้วว่าผู้ใช้เป็น OWNER ของ**ทั้งสองร้าน** (ตรวจที่ action) — ฟังก์ชันนี้รับ storeId ตรง ๆ
/// ใน tx ของ prisma ดิบ เพราะแตะสองร้านพร้อมกันซึ่ง forStore() ทำไม่ได้ · ทุก query ระบุ storeId ชัดทั้งสองฝั่ง
///
/// กติกา: คัดลอกเฉพาะรายการที่ยังขายอยู่ (isActive) · รายการที่ปลายทางมีชื่อเดียวกันอยู่แล้ว "ข้าม" ไม่ทับ (เรียกซ้ำได้)
/// · เมนูแนะนำ (isFeatured) ไม่ติดไป — เพดาน 6 รายการเป็นของแต่ละสาขา ให้เจ้าของเลือกเองที่ตั้งค่าร้าน
/// · imageUrl คัดลอกเป็นข้อความ (ชี้ไฟล์เดิม) ไม่ก๊อปปี้ไฟล์
/// · (Phase 19) ประเภทครัวติดไปด้วย — ปลายทางที่มี station ชื่อเดียวกันอยู่แล้วใช้ตัวเดิม ไม่สร้างซ้ำ (unique storeId+name)

export type MenuCopyResult = { copied: number; skipped: number }

export async function copyMenu(
  tx: Prisma.TransactionClient,
  sourceStoreId: string,
  targetStoreId: string,
): Promise<MenuCopyResult> {
  if (sourceStoreId === targetStoreId) throw new Error("MENU_COPY_SAME_STORE")

  const [source, existing] = await Promise.all([
    tx.menuItem.findMany({
      where: { storeId: sourceStoreId, isActive: true },
      orderBy: { createdAt: "asc" },
      include: {
        station: { select: { name: true, sortOrder: true } },
        modifierGroups: { orderBy: { sortOrder: "asc" }, include: { options: { orderBy: { sortOrder: "asc" } } } },
      },
    }),
    tx.menuItem.findMany({ where: { storeId: targetStoreId }, select: { name: true } }),
  ])
  const taken = new Set(existing.map((m) => m.name.trim().toLowerCase()))

  // ประเภทครัวที่ปลายทาง — หาตามชื่อก่อน ไม่มีค่อยสร้าง (Phase 19)
  const stationIdByName = new Map<string, string>()
  async function stationIdFor(station: { name: string; sortOrder: number } | null): Promise<string | null> {
    if (!station) return null
    const cached = stationIdByName.get(station.name)
    if (cached) return cached
    const row = await tx.kitchenStation.upsert({
      where: { storeId_name: { storeId: targetStoreId, name: station.name } },
      update: {},
      create: { storeId: targetStoreId, name: station.name, sortOrder: station.sortOrder },
      select: { id: true },
    })
    stationIdByName.set(station.name, row.id)
    return row.id
  }

  let copied = 0
  let skipped = 0
  for (const item of source) {
    if (taken.has(item.name.trim().toLowerCase())) {
      skipped += 1
      continue
    }
    taken.add(item.name.trim().toLowerCase())
    await tx.menuItem.create({
      data: {
        storeId: targetStoreId,
        name: item.name,
        description: item.description,
        price: item.price,
        imageUrl: item.imageUrl,
        isActive: true,
        isFeatured: false,
        featuredSortOrder: null,
        stationId: await stationIdFor(item.station),
        modifierGroups: {
          create: item.modifierGroups.map((group) => ({
            // nested create ของ model ที่มี storeId — ต้องใส่เอง (extension ช่วยไม่ได้ และที่นี่ไม่ได้ผ่าน extension อยู่แล้ว)
            storeId: targetStoreId,
            name: group.name,
            selectionType: group.selectionType,
            required: group.required,
            sortOrder: group.sortOrder,
            options: {
              create: group.options.map((option) => ({
                name: option.name,
                priceDelta: option.priceDelta,
                sortOrder: option.sortOrder,
              })),
            },
          })),
        },
      },
      select: { id: true },
    })
    copied += 1
  }
  return { copied, skipped }
}
