import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../generated/prisma/client"
import { seedMobileOrder } from "./seed-mobile-order"
import { provisionStore } from "../lib/store-provision"

/// ร้านแรก — id คงที่ตรงกับ migration add_multi_tenant (ข้อมูล v1 ทั้งหมดถูก backfill มาที่ร้านนี้)
const DEFAULT_STORE = { id: "store_default", slug: "default", name: "MJD Kitchen" }
/// ร้านที่สอง (ว่าง) — ไว้ลองสลับร้านและให้เทส/เดโมเห็นว่าข้อมูลแยกกันจริง
const SECOND_STORE = { id: "store_demo_2", slug: "demo-2", name: "ร้านสาขาสอง (ตัวอย่าง)" }

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error("ไม่พบ DATABASE_URL — ตรวจไฟล์ .env ก่อนรัน seed")

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const CATEGORIES = ["เครื่องเขียน", "อุปกรณ์ไฟฟ้า", "ของใช้ทั่วไป"]

const PRODUCTS = [
  { sku: "SKU-1001", name: "ปากกาลูกลื่น สีน้ำเงิน", category: "เครื่องเขียน", unit: "ด้าม", quantity: 120, reorderPoint: 30, price: "5.00" },
  { sku: "SKU-1002", name: "สมุดโน้ต A5 80 แผ่น", category: "เครื่องเขียน", unit: "เล่ม", quantity: 45, reorderPoint: 20, price: "35.00" },
  { sku: "SKU-1003", name: "กระดาษ A4 80 แกรม", category: "เครื่องเขียน", unit: "รีม", quantity: 18, reorderPoint: 20, price: "125.00" },
  { sku: "SKU-1004", name: "หลอดไฟ LED 9W", category: "อุปกรณ์ไฟฟ้า", unit: "หลอด", quantity: 60, reorderPoint: 15, price: "89.00" },
  { sku: "SKU-1005", name: "ปลั๊กพ่วง 5 ช่อง 3 เมตร", category: "อุปกรณ์ไฟฟ้า", unit: "อัน", quantity: 8, reorderPoint: 10, price: "290.00" },
  { sku: "SKU-1006", name: "น้ำยาทำความสะอาดพื้น 3.8 ลิตร", category: "ของใช้ทั่วไป", unit: "แกลลอน", quantity: 24, reorderPoint: 8, price: "165.00" },
  { sku: "SKU-1007", name: "ถุงขยะดำ 30x40 นิ้ว", category: "ของใช้ทั่วไป", unit: "แพ็ค", quantity: 5, reorderPoint: 12, price: "75.00" },
]

/// บิลตัวอย่างสำหรับ demo/report — อ้างสินค้าด้วย SKU และวันที่ย้อนหลังเป็นจำนวนวัน
const SAMPLE_SALES = [
  { daysAgo: 6, paymentMethod: "CASH" as const, discount: 0, lines: [{ sku: "SKU-1001", quantity: 10 }, { sku: "SKU-1002", quantity: 2 }] },
  { daysAgo: 5, paymentMethod: "TRANSFER" as const, discount: 20, lines: [{ sku: "SKU-1004", quantity: 4 }] },
  { daysAgo: 4, paymentMethod: "QR" as const, discount: 0, lines: [{ sku: "SKU-1006", quantity: 2 }, { sku: "SKU-1007", quantity: 1 }] },
  { daysAgo: 3, paymentMethod: "CASH" as const, discount: 15, lines: [{ sku: "SKU-1003", quantity: 3 }] },
  { daysAgo: 2, paymentMethod: "CASH" as const, discount: 0, lines: [{ sku: "SKU-1001", quantity: 24 }] },
  { daysAgo: 1, paymentMethod: "QR" as const, discount: 0, lines: [{ sku: "SKU-1002", quantity: 5 }, { sku: "SKU-1004", quantity: 2 }] },
  { daysAgo: 1, paymentMethod: "TRANSFER" as const, discount: 50, lines: [{ sku: "SKU-1005", quantity: 1 }], voided: true },
  { daysAgo: 0, paymentMethod: "CASH" as const, discount: 0, lines: [{ sku: "SKU-1006", quantity: 1 }, { sku: "SKU-1001", quantity: 6 }] },
]

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

async function seedProducts(storeId: string) {
  for (const name of CATEGORIES) {
    await prisma.category.upsert({
      where: { storeId_name: { storeId, name } },
      update: {},
      create: { storeId, name },
    })
  }

  for (const product of PRODUCTS) {
    const category = await prisma.category.findUniqueOrThrow({
      where: { storeId_name: { storeId, name: product.category } },
    })
    await prisma.product.upsert({
      where: { storeId_sku: { storeId, sku: product.sku } },
      update: {},
      create: {
        storeId,
        sku: product.sku,
        name: product.name,
        categoryId: category.id,
        unit: product.unit,
        quantity: product.quantity,
        reorderPoint: product.reorderPoint,
        price: product.price,
      },
    })
  }

  // ledger ตั้งต้นให้ยอดคงเหลือมีที่มา — สร้างเฉพาะตอนยังไม่มีรายการใด ๆ
  const existing = await prisma.stockTransaction.count({ where: { storeId } })
  if (existing === 0) {
    const created = await prisma.product.findMany({ where: { storeId }, select: { id: true, quantity: true } })
    await prisma.stockTransaction.createMany({
      data: created.map((p) => ({
        storeId,
        productId: p.id,
        type: "IN" as const,
        quantity: p.quantity,
        note: "ยอดยกมาตั้งต้น (seed)",
      })),
    })
  }
}

/// บิลขายตัวอย่าง — ทำเฉพาะตอนยังไม่มีบิลใด ๆ และต้องมีผู้ใช้ในระบบก่อน (Sale.cashierId เป็น FK → user)
async function seedSales(storeId: string) {
  const existing = await prisma.sale.count({ where: { storeId } })
  if (existing > 0) {
    console.info("มีบิลขายอยู่แล้ว — ข้ามการ seed บิลตัวอย่าง")
    return
  }

  const cashier = await prisma.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } })
  if (!cashier) {
    console.info("ยังไม่มีผู้ใช้ในระบบ — ข้ามการ seed บิลตัวอย่าง (สมัครสมาชิกแล้วรัน seed ซ้ำได้)")
    return
  }

  let sequence = 0
  for (const sample of SAMPLE_SALES) {
    sequence += 1
    const saleNumber = `INV-${String(sequence).padStart(6, "0")}`
    const createdAt = new Date(Date.now() - sample.daysAgo * 86_400_000)

    await prisma.$transaction(async (tx) => {
      const items = []
      for (const line of sample.lines) {
        const product = await tx.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: line.sku } } })
        const unitPrice = Number(product.price)
        items.push({
          productId: product.id,
          name: product.name,
          quantity: line.quantity,
          unitPrice,
          subtotal: round2(unitPrice * line.quantity),
        })
      }

      const subtotal = round2(items.reduce((sum, i) => sum + i.subtotal, 0))
      const discount = Math.min(sample.discount, subtotal)
      const total = round2(subtotal - discount)
      const received = sample.paymentMethod === "CASH" ? Math.ceil(total / 100) * 100 : total

      const sale = await tx.sale.create({
        data: {
          storeId,
          saleNumber,
          status: sample.voided ? "VOIDED" : "COMPLETED",
          subtotal: subtotal.toFixed(2),
          discount: discount.toFixed(2),
          total: total.toFixed(2),
          paymentMethod: sample.paymentMethod,
          amountReceived: received.toFixed(2),
          changeDue: round2(received - total).toFixed(2),
          cashierId: cashier.id,
          createdAt,
          ...(sample.voided
            ? { voidedAt: createdAt, voidedById: cashier.id, voidReason: "ตัวอย่างบิลที่ถูกยกเลิก (seed)" }
            : {}),
        },
      })

      for (const item of items) {
        await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productId: item.productId,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice.toFixed(2),
            subtotal: item.subtotal.toFixed(2),
          },
        })
        await tx.stockTransaction.create({
          data: {
            storeId,
            productId: item.productId,
            type: "OUT",
            quantity: item.quantity,
            saleId: sale.id,
            createdAt,
            note: `ขายหน้าร้าน ${saleNumber}`,
          },
        })
        await tx.product.update({
          where: { id: item.productId },
          data: { quantity: { decrement: item.quantity } },
        })

        // บิลที่ยกเลิก: คืนสต็อกด้วยรายการชดเชย ไม่ลบรายการ OUT เดิม (ledger append-only)
        if (sample.voided) {
          await tx.stockTransaction.create({
            data: {
              storeId,
              productId: item.productId,
              type: "IN",
              quantity: item.quantity,
              saleId: sale.id,
              createdAt,
              note: `ยกเลิกบิล ${saleNumber}`,
            },
          })
          await tx.product.update({
            where: { id: item.productId },
            data: { quantity: { increment: item.quantity } },
          })
        }
      }
    })
  }

  console.info(`seed บิลตัวอย่าง ${SAMPLE_SALES.length} บิลเรียบร้อย`)
}

async function main() {
  console.info("กำลัง seed ข้อมูลตัวอย่าง…")

  // ร้าน + settings + บทบาทระบบ ก่อนทุกอย่าง (Phase 13) — ผู้ใช้ทุกคนที่มีอยู่เป็น OWNER ของร้านแรก
  const { storeId } = await provisionStore(prisma, DEFAULT_STORE)
  await provisionStore(prisma, SECOND_STORE)
  const users = await prisma.user.findMany({ where: { id: { not: "system" } }, select: { id: true } })
  for (const user of users) {
    await prisma.storeMember.upsert({
      where: { userId_storeId: { userId: user.id, storeId } },
      update: {},
      create: { userId: user.id, storeId, role: "OWNER" },
    })
  }

  await seedProducts(storeId)
  await seedSales(storeId)
  await seedMobileOrder(prisma, storeId)

  const [products, categories, sales] = await Promise.all([
    prisma.product.count({ where: { storeId } }),
    prisma.category.count({ where: { storeId } }),
    prisma.sale.count({ where: { storeId } }),
  ])
  console.info(
    `seed เรียบร้อย — ร้าน ${DEFAULT_STORE.name}: สินค้า ${products} รายการ, หมวดหมู่ ${categories} หมวด, บิลขาย ${sales} บิล ` +
      `(+ ร้านว่าง ${SECOND_STORE.name})`,
  )
}

main()
  .catch((error) => {
    console.error("seed ล้มเหลว:", error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
