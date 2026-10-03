"use client"

import { useState } from "react"
import { IconEye, IconEyeOff } from "@/components/icons"

/// ช่องรหัสผ่านพร้อมปุ่มรูปตาสลับแสดง/ซ่อน — ผู้ใช้เช็คได้ว่าพิมพ์ถูกไหม (เจ้าของสั่ง 2026-10-03)
/// รับ props ของ <input> ตามปกติ (name/id/autoComplete/minLength …) ใช้แทน <input type="password" className="input">
type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">

export function PasswordInput({ className, ...props }: Props) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="password-field">
      <input {...props} type={visible ? "text" : "password"} className={className ?? "input"} />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
        aria-pressed={visible}
        disabled={props.disabled}
      >
        {visible ? <IconEyeOff size={18} aria-hidden /> : <IconEye size={18} aria-hidden />}
      </button>
    </div>
  )
}
