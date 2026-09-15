import "dotenv/config"
import { auth } from "../lib/auth"
import { prisma } from "../lib/prisma"

/// สร้างบัญชีพนักงานจากบรรทัดคำสั่ง — เพราะ `disableSignUp: true` ปิดการสมัครเองไว้ (lib/auth.ts)
///
///   pnpm db:create-user "อีเมล" "รหัสผ่าน" "ชื่อที่แสดง" [--store slug] [--role OWNER|STAFF]
///
/// Phase 13: บัญชีต้องอยู่ในร้านถึงจะใช้งานได้ — ค่าเริ่มต้นคือร้าน `default` ในบทบาท OWNER
/// ระบุ `--store <slug>` เพื่อใส่ร้านอื่น และ `--role STAFF` ถ้าไม่ใช่เจ้าของ (STAFF ยังไม่มี matrix สิทธิ์
/// จนกว่า OWNER จะกำหนดให้ที่หน้า /users)
///
/// ⚠️ ต้องสร้างผ่าน internalAdapter ของ Better Auth เท่านั้น ห้าม insert ตาราง account เอง —
///    รูปแบบ account ของ credential คือ `issuer = local:credential` และ `accountId = user.id`
///    (ไม่ใช่อีเมล) ถ้าใส่ผิดจะสร้างได้แต่ล็อกอินไม่ผ่าน ตอบ INVALID_EMAIL_OR_PASSWORD
function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

async function main() {
  const args = process.argv.slice(2)
  const storeSlug = readFlag(args, "--store") ?? "default"
  const roleFlag = (readFlag(args, "--role") ?? "OWNER").toUpperCase()
  const positional = args.filter((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--store" && args[i - 1] !== "--role")
  const [email, password, name] = positional

  if (roleFlag !== "OWNER" && roleFlag !== "STAFF") {
    console.error("--role ต้องเป็น OWNER หรือ STAFF")
    process.exit(1)
  }

  if (!email || !password) {
    console.error('วิธีใช้: pnpm db:create-user "อีเมล" "รหัสผ่าน" ["ชื่อที่แสดง"]')
    process.exit(1)
  }
  if (password.length < 8) {
    console.error("รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร")
    process.exit(1)
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    console.error(`มีบัญชีอีเมล ${email} อยู่แล้ว`)
    process.exit(1)
  }

  const store = await prisma.store.findUnique({ where: { slug: storeSlug }, select: { id: true, name: true } })
  if (!store) {
    console.error(`ไม่พบร้าน slug "${storeSlug}" — รัน pnpm db:seed ก่อน หรือระบุ --store ให้ถูก`)
    process.exit(1)
  }

  const ctx = await auth.$context

  const user = await ctx.internalAdapter.createUser(
    {
      email,
      name: name ?? email.split("@")[0],
      emailVerified: true,
    },
    { method: "email-password" },
  )

  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    // createLocalAccountIssuer("credential") ของ @better-auth/core คืนค่านี้ตรง ๆ
    issuer: "local:credential",
    accountId: user.id,
    password: await ctx.password.hash(password),
  })

  await prisma.storeMember.create({
    data: { userId: user.id, storeId: store.id, role: roleFlag },
  })

  console.info(
    `สร้างบัญชี ${user.email} (${user.name}) เรียบร้อยแล้ว — เป็น ${roleFlag} ของร้าน ${store.name} · ล็อกอินได้ทันที`,
  )
}

main()
  .catch((error) => {
    console.error("สร้างบัญชีไม่สำเร็จ:", error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
