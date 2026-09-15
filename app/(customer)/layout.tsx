import type { Metadata } from "next"
import { Prompt, Sarabun } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import "../globals.css"

// ฟอนต์คนละชุดกับฝั่งพนักงานโดยตั้งใจ — หน้าลูกค้าเปิดบนเน็ตมือถือ
// ไม่ควรโหลดฟอนต์ฝั่งพนักงานทิ้งเปล่า (ดู §6a ใน spec)
const prompt = Prompt({
  variable: "--font-prompt",
  subsets: ["thai", "latin"],
  weight: ["500", "600", "700"],
  display: "swap",
})
const sarabun = Sarabun({
  variable: "--font-sarabun",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600"],
  display: "swap",
})

export const metadata: Metadata = {
  title: "สั่งอาหาร",
  description: "สั่งอาหารผ่าน QR Code",
}

export default function CustomerRootLayout({ children }: { children: React.ReactNode }) {
  // สีของร้านอยู่ที่ order/[qrToken]/layout.tsx (Phase 13) — root layout ไม่รู้ว่าเป็นร้านไหน
  // เพราะ qrToken เป็น segment ลูก ค่าธีมของแต่ละร้านจึงถูกใส่บน wrapper ที่นั่นแทน body
  return (
    <html lang="th" data-theme="customer" className={`${prompt.variable} ${sarabun.variable}`}>
      <body className="antialiased">
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  )
}
