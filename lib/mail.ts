/// จุดเดียวของระบบที่ส่งอีเมล — ส่งผ่าน Resend HTTP API ด้วย `fetch` ไม่เพิ่ม dependency
///
/// | env | ความหมาย |
/// |---|---|
/// | `RESEND_API_KEY` | ไม่ตั้ง → dev พิมพ์ลิงก์ลง console, production throw |
/// | `MAIL_FROM`      | ต้องอยู่ใต้โดเมนที่ verify กับ Resend ไว้แล้ว |
/// | `MAIL_REPLY_TO`  | ไม่บังคับ |
///
/// ⚠️ **ห้ามพิมพ์ลิงก์ยืนยัน/รีเซ็ตรหัสผ่านลง log บน production** — ลิงก์คือ credential ชั่วคราว
///    ที่ใครอ่าน log ได้ก็ยึดบัญชีได้ ทางนี้จึงพิมพ์เฉพาะตอน `NODE_ENV !== "production"` เท่านั้น
///
/// อีเมลใช้ **inline style + สี hex ดิบ** โดยตั้งใจ — mail client ไม่รองรับ `var()` และตัด `<style>`
/// ทิ้งบ่อย นี่คือข้อยกเว้นเดียวของกติกา "ห้ามใส่ hex ดิบในโค้ด"

const RESEND_ENDPOINT = "https://api.resend.com/emails"
const DEFAULT_FROM = "MJD Mobile Order <no-reply@mail.jayjayservices.com>"

type MailTemplate = {
  subject: string
  heading: string
  intro: string
  buttonLabel: string
  footnote: string
}

export type MailResult = { ok: true; skipped: boolean } | { ok: false; error: string }

/// escape ค่าที่ฝังลง HTML ของอีเมล — ชื่อร้าน/อีเมลผู้ใช้เป็นข้อมูลที่ผู้ใช้กรอกเองได้
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function renderHtml(template: MailTemplate, url: string): string {
  const safeUrl = escapeHtml(url)
  return `<!doctype html>
<html lang="th">
  <body style="margin:0;padding:24px;background-color:#F5F6F7;font-family:'Segoe UI',Tahoma,sans-serif;color:#1B2733;">
    <table role="presentation" style="max-width:520px;margin:0 auto;background-color:#FFFFFF;border-radius:12px;border:1px solid #E3E7EB;">
      <tr>
        <td style="padding:28px 28px 8px 28px;">
          <p style="margin:0;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#01787B;">MJD Mobile Order</p>
          <h1 style="margin:8px 0 0 0;font-size:20px;line-height:1.4;color:#1B2733;">${escapeHtml(template.heading)}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 28px 0 28px;">
          <p style="margin:0;font-size:15px;line-height:1.7;color:#43505E;">${escapeHtml(template.intro)}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px;">
          <a href="${safeUrl}" style="display:inline-block;background-color:#01787B;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px;">${escapeHtml(template.buttonLabel)}</a>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 28px 28px;">
          <p style="margin:0 0 8px 0;font-size:13px;line-height:1.7;color:#6B7885;">${escapeHtml(template.footnote)}</p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#8B96A2;word-break:break-all;">เปิดลิงก์ไม่ได้? คัดลอกที่อยู่นี้ไปวางในเบราว์เซอร์:<br />${safeUrl}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function renderText(template: MailTemplate, url: string): string {
  return [template.heading, "", template.intro, "", url, "", template.footnote].join("\n")
}

async function deliver(to: string, template: MailTemplate, url: string): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ยังไม่ได้ตั้งค่า RESEND_API_KEY — ระบบส่งอีเมลใช้งานไม่ได้")
    }
    console.info(`\n[dev mail] ${template.subject}\n  ถึง: ${to}\n  ลิงก์: ${url}\n`)
    return { ok: true, skipped: true }
  }

  const replyTo = process.env.MAIL_REPLY_TO?.trim()

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM?.trim() || DEFAULT_FROM,
        to: [to],
        subject: template.subject,
        html: renderHtml(template, url),
        text: renderText(template, url),
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    })

    if (!response.ok) {
      // อ่าน body ไว้บอกสาเหตุ (โดเมนยังไม่ verify / key ผิด) แต่ **ไม่แตะตัวลิงก์**
      const detail = await response.text().catch(() => "")
      return { ok: false, error: `Resend ตอบ ${response.status} ${detail.slice(0, 300)}` }
    }

    return { ok: true, skipped: false }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

export async function sendResetPasswordMail(to: string, url: string): Promise<MailResult> {
  return deliver(
    to,
    {
      subject: "ตั้งรหัสผ่านใหม่ — MJD Mobile Order",
      heading: "ตั้งรหัสผ่านใหม่",
      intro: "มีคำขอตั้งรหัสผ่านใหม่สำหรับบัญชีนี้ กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่",
      buttonLabel: "ตั้งรหัสผ่านใหม่",
      footnote: "ลิงก์นี้ใช้ได้ครั้งเดียวและหมดอายุใน 1 ชั่วโมง ถ้าคุณไม่ได้เป็นคนขอ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ",
    },
    url,
  )
}

export async function sendVerificationMail(to: string, url: string): Promise<MailResult> {
  return deliver(
    to,
    {
      subject: "ยืนยันอีเมลของคุณ — MJD Mobile Order",
      heading: "ยืนยันอีเมลของคุณ",
      intro: "กดปุ่มด้านล่างเพื่อยืนยันอีเมล หลังยืนยันแล้วจึงจะเข้าสู่ระบบได้",
      buttonLabel: "ยืนยันอีเมล",
      footnote: "ถ้าคุณไม่ได้เป็นคนสมัคร ไม่ต้องทำอะไร บัญชีจะใช้งานไม่ได้จนกว่าจะมีการยืนยัน",
    },
    url,
  )
}

/// คำเชิญเข้าร้าน (Phase 14a) — ชื่อร้าน/ชื่อผู้เชิญเป็นข้อมูลที่ผู้ใช้กรอกเอง escape ใน renderHtml แล้ว
export async function sendStoreInviteMail(
  to: string,
  invite: { storeName: string; inviterName: string; role: "OWNER" | "STAFF"; url: string },
): Promise<MailResult> {
  const roleLabel = invite.role === "OWNER" ? "เจ้าของร้าน" : "พนักงาน"
  return deliver(
    to,
    {
      subject: `${invite.inviterName} เชิญคุณเข้าร่วมร้าน ${invite.storeName} — MJD Mobile Order`,
      heading: `คุณได้รับเชิญเข้าร่วมร้าน ${invite.storeName}`,
      intro: `${invite.inviterName} เชิญคุณเข้าร่วมร้าน ${invite.storeName} ในบทบาท${roleLabel} กดปุ่มด้านล่างเพื่อตอบรับ — ถ้ายังไม่มีบัญชี ระบบจะให้สมัครด้วยอีเมลนี้ก่อน`,
      buttonLabel: "ตอบรับคำเชิญ",
      footnote: "ลิงก์นี้ใช้ได้ครั้งเดียวและหมดอายุใน 7 วัน ต้องตอบรับด้วยบัญชีที่ใช้อีเมลเดียวกับที่ได้รับอีเมลนี้ ถ้าคุณไม่รู้จักร้านนี้ ไม่ต้องทำอะไร",
    },
    invite.url,
  )
}
