import { prisma } from "@/lib/prisma"

/// ชั้นกันลืม `where: { storeId }` (Phase 13)
///
/// ทุก query/action ที่แตะข้อมูลของร้านต้องเรียกผ่าน `forStore(storeId)` ไม่ใช่ `prisma` ตรง ๆ —
/// extension นี้ยัด `storeId` เข้า `where` ของทุกคำสั่งอ่าน/แก้/ลบ และเข้า `data` ของทุกคำสั่งสร้าง
/// ให้กับ model ที่มีคอลัมน์นี้ จึงไม่มีทางที่ร้าน A จะอ่านหรือแก้แถวของร้าน B ผ่านทางนี้ได้
///
/// สิ่งที่ extension ช่วยไม่ได้ และต้องระวังเอง:
///   - raw SQL (`$queryRaw`) — ต้องเติม `WHERE "storeId" = ${storeId}` ด้วยมือทุกจุด
///   - `findUnique({ where: { id } })` ด้วย id ที่รับจากผู้ใช้ — extension เติม storeId ให้แล้ว
///     (Prisma รับ non-unique field ใน where ของ findUnique/update/delete ได้) จึงได้ null แทนแถวของร้านอื่น
///   - nested create ของ model ที่มี storeId ผ่าน relation ของ model อื่น (เช่น
///     `menuItem.create({ data: { modifierGroups: { create: [...] } } })`) — ต้องใส่ storeId ในข้อมูลลูกเอง
///
/// ห้ามใช้ `prisma` ตรง ๆ ใน `app/actions/**` และ `lib/queries.ts` — มี ESLint rule กันไว้
/// ที่ยังใช้ prisma ตรงได้: auth, health, webhook (ก่อนรู้ว่าเป็นร้านไหน), สคริปต์ และ lib/session.ts

/// model (ชื่อตาม Prisma ไม่ใช่ชื่อตาราง) ที่มีคอลัมน์ storeId — ต้องตรงกับ schema.prisma
export const STORE_SCOPED_MODELS: ReadonlySet<string> = new Set([
  "Product",
  "StockTransaction",
  "Category",
  "Sale",
  "CashierClosing",
  "Table",
  "TableSession",
  "MenuItem",
  "ModifierGroup",
  "MobileOrder",
  "QRCode",
  "Notification",
  "StoreSettings",
  "Member",
  "PaymentIntent",
  "Role",
  "StoreMember",
  "StoreInvite",
])

type AnyArgs = Record<string, unknown>

function withStoreWhere(args: AnyArgs, storeId: string): AnyArgs {
  const where = (args.where ?? {}) as AnyArgs
  return { ...args, where: { ...where, storeId } }
}

function withStoreData(data: unknown, storeId: string): unknown {
  if (Array.isArray(data)) return data.map((row) => ({ ...(row as AnyArgs), storeId }))
  return { ...(data as AnyArgs), storeId }
}

export function forStore(storeId: string) {
  if (!storeId) throw new Error("forStore() ต้องได้ storeId เสมอ — เรียก requireStore() ก่อน")

  return prisma.$extends({
    name: `forStore(${storeId})`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!STORE_SCOPED_MODELS.has(model)) return query(args)
          const a = args as AnyArgs
          let next: AnyArgs = a

          switch (operation) {
            case "create":
            case "createMany":
            case "createManyAndReturn":
              next = { ...a, data: withStoreData(a.data, storeId) }
              break
            case "upsert":
              next = { ...withStoreWhere(a, storeId), create: withStoreData(a.create, storeId) }
              break
            case "findUnique":
            case "findUniqueOrThrow":
            case "findFirst":
            case "findFirstOrThrow":
            case "findMany":
            case "update":
            case "updateMany":
            case "updateManyAndReturn":
            case "delete":
            case "deleteMany":
            case "count":
            case "aggregate":
            case "groupBy":
              next = withStoreWhere(a, storeId)
              break
          }
          return query(next as typeof args)
        },
      },
    },
  })
}

export type StoreDb = ReturnType<typeof forStore>
/// client ภายใน `db.$transaction(async (tx) => …)` ของ StoreDb
export type StoreTx = Parameters<Parameters<StoreDb["$transaction"]>[0]>[0]
