import { redirect } from "next/navigation"

/// กระดานห้องนวดย้ายไปเป็นแท็บ "ตอนนี้" ของหน้า "คิวนวด" แล้ว (2026-10-08 รวมสองหน้าเป็นหน้าเดียว)
/// เก็บ route นี้ไว้ให้ลิงก์/บุ๊กมาร์กเดิมยังใช้ได้ — พาวันที่ที่เลือกไปด้วย
export default async function SpaBoardPage({ searchParams }: PageProps<"/spa/board">) {
  const query = await searchParams
  const date = typeof query.date === "string" ? `&date=${encodeURIComponent(query.date)}` : ""
  redirect(`/spa/bookings?tab=now${date}`)
}
