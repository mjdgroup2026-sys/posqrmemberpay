import "dotenv/config"
import { prisma } from "../lib/prisma"

/// ตั้ง/ถอดสถานะผู้ดูแลแพลตฟอร์มให้บัญชีที่มีอยู่ (Phase 14a)
///
///   pnpm db:set-platform-admin "อีเมล"          → เป็นผู้ดูแลแพลตฟอร์ม (เห็นเมนู "แพลตฟอร์ม" + /admin/*)
///   pnpm db:set-platform-admin "อีเมล" --off    → ถอดออก
///
/// ทำจากบรรทัดคำสั่งเท่านั้นโดยตั้งใจ — ไม่มีหน้า UI ให้ตั้ง เพราะสิทธิ์นี้ข้ามทุกร้าน (ระงับร้านใดก็ได้)
/// จึงต้องเป็นคนที่เข้าถึงเซิร์ฟเวอร์/ฐานได้อยู่แล้วเท่านั้น · คนละแกนกับ StoreMember.role
async function main() {
  const args = process.argv.slice(2)
  const off = args.includes("--off")
  const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase()

  if (!email) {
    console.error('วิธีใช้: pnpm db:set-platform-admin "อีเมล" [--off]')
    process.exit(1)
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, isPlatformAdmin: true } })
  if (!user) {
    console.error(`ไม่พบผู้ใช้อีเมล ${email} — สร้างบัญชีก่อนด้วย pnpm db:create-user หรือให้สมัครผ่านหน้าเว็บ`)
    process.exit(1)
  }

  const next = !off
  if (user.isPlatformAdmin === next) {
    console.log(`${user.name} <${email}> ${next ? "เป็น" : "ไม่ได้เป็น"}ผู้ดูแลแพลตฟอร์มอยู่แล้ว — ไม่ต้องเปลี่ยน`)
    return
  }

  await prisma.user.update({ where: { id: user.id }, data: { isPlatformAdmin: next } })
  console.log(`${next ? "ตั้ง" : "ถอด"} ${user.name} <${email}> ${next ? "เป็น" : "ออกจาก"}ผู้ดูแลแพลตฟอร์มแล้ว`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
