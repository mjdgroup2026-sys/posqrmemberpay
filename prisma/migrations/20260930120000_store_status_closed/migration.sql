-- เจ้าของปิดร้านเอง (2026-09-30) — แยกไฟล์จากที่ใช้ค่าใหม่ เพราะ PostgreSQL ห้ามใช้ค่า enum ที่เพิ่งเพิ่มในทรานแซคชันเดียวกัน

-- AlterEnum
ALTER TYPE "StoreStatus" ADD VALUE 'CLOSED';
