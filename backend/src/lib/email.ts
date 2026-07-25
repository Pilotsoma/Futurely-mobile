import nodemailer from 'nodemailer'

interface MailOptions {
  to: string
  subject: string
  html: string
}

// Use Resend's HTTP API when the API key is present — more reliable than SMTP
// in serverless environments (no TLS handshake, no connection timeout).
async function sendViaResend(opts: MailOptions): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY ?? process.env.SMTP_PASS
  const from = process.env.SMTP_FROM ?? 'myFuturely <onboarding@resend.dev>'

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, html: opts.html }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Resend API error ${res.status}: ${body}`)
  }
}

async function sendViaSMTP(opts: MailOptions): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  })
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? '"myFuturely" <noreply@myfuturely.ai>',
    ...opts,
  })
}

export async function sendEmail(opts: MailOptions): Promise<void> {
  // Prefer Resend HTTP API (works reliably in Vercel serverless)
  const useResend =
    process.env.RESEND_API_KEY ||
    process.env.SMTP_HOST === 'smtp.resend.com' ||
    (process.env.SMTP_PASS ?? '').startsWith('re_')

  if (useResend) {
    await sendViaResend(opts)
    return
  }

  if (process.env.SMTP_HOST) {
    await sendViaSMTP(opts)
    return
  }

  // No email provider configured — log the full content for local dev so
  // OTP codes and links are still visible in the terminal.
  console.log(`[EMAIL] Not configured. To=${opts.to} Subject="${opts.subject}"\n${opts.html}`)
}
import { safeConsole as console } from '../common/safeConsole'
