/**
 * Transactional email via Resend (https://resend.com).
 */

import { readFileSync } from "fs";
import { join } from "path";
import { appOrigin } from "@/lib/googleOAuth";

const LOGO_CID = "intrisal-logo";

/** Public HTTPS origin for links inside emails. */
function emailLinkOrigin() {
  const configured = process.env.EMAIL_ASSET_URL?.trim() || process.env.AUTH_URL?.trim() || appOrigin();
  if (configured && !/localhost|127\.0\.0\.1/i.test(configured)) {
    const withProtocol = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
    return withProtocol.replace(/\/+$/, "");
  }
  return "https://www.intrisal.com";
}

function brandLogoAttachment() {
  const filePath = join(process.cwd(), "public", "brand", "intrisal-email-logo.png");
  const content = readFileSync(filePath).toString("base64");
  return {
    filename: "intrisal-logo.png",
    content,
    content_id: LOGO_CID,
  };
}

function brandHeader() {
  const home = escapeHtml(emailLinkOrigin());
  // Inline CID image — baked onto #0a0a0a so it blends with the email card (no nested box).
  return `<tr><td style="padding:0 0 18px 0;">
    <a href="${home}" style="text-decoration:none;border:0;">
      <img src="cid:${LOGO_CID}" width="56" height="56" alt="Intrisal" style="display:block;border:0;width:56px;height:56px;" />
    </a>
  </td></tr>`;
}

export function mailConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim() && appOrigin());
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    throw new Error("Email sending is not configured. Set RESEND_API_KEY and EMAIL_FROM.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: [brandLogoAttachment()],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Could not send email${detail ? ": " + detail.slice(0, 180) : " (HTTP " + response.status + ")"}`,
    );
  }
}

export function passwordResetEmail(input: { name: string; resetUrl: string }) {
  const first = input.name.trim().split(/\s+/)[0] || "there";
  const subject = "Reset your Intrisal password";
  const text =
    `Hi ${first},\n\n` +
    `We received a request to reset your Intrisal password.\n\n` +
    `Open this link to choose a new password (expires in 1 hour):\n${input.resetUrl}\n\n` +
    `If you did not ask for this, you can ignore this email.\n\n` +
    `— Intrisal`;
  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#050505;color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#0a0a0a;border:1px solid #232323;border-radius:16px;padding:32px 28px;">
          ${brandHeader()}
          <tr><td style="font-size:22px;font-weight:700;letter-spacing:-0.02em;padding-bottom:12px;">Reset your password</td></tr>
          <tr><td style="font-size:15px;line-height:1.55;color:#b5b5b5;padding-bottom:24px;">
            Hi ${escapeHtml(first)}, we received a request to reset the password for your Intrisal account.
            This link expires in one hour.
          </td></tr>
          <tr><td style="padding-bottom:28px;">
            <a href="${escapeHtml(input.resetUrl)}" style="display:inline-block;background:#ffffff;color:#000000;text-decoration:none;font-weight:650;font-size:15px;padding:12px 20px;border-radius:999px;">
              Choose a new password
            </a>
          </td></tr>
          <tr><td style="font-size:13px;line-height:1.5;color:#7d7d7d;">
            If the button does not work, paste this link into your browser:<br/>
            <span style="color:#b5b5b5;word-break:break-all;">${escapeHtml(input.resetUrl)}</span>
          </td></tr>
          <tr><td style="font-size:12px;line-height:1.5;color:#7d7d7d;padding-top:24px;border-top:1px solid #232323;">
            If you did not request a password reset, you can ignore this email.
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  return { subject, html, text };
}

export function googleAccountReminderEmail(input: { name: string; loginUrl: string }) {
  const first = input.name.trim().split(/\s+/)[0] || "there";
  const subject = "Your Intrisal account uses Google sign-in";
  const text =
    `Hi ${first},\n\n` +
    `Someone requested a password reset for your Intrisal account, but this email signs in with Google.\n\n` +
    `Use Continue with Google here:\n${input.loginUrl}\n\n` +
    `If you did not ask for this, you can ignore this email.\n\n` +
    `— Intrisal`;
  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#050505;color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#0a0a0a;border:1px solid #232323;border-radius:16px;padding:32px 28px;">
          ${brandHeader()}
          <tr><td style="font-size:22px;font-weight:700;letter-spacing:-0.02em;padding-bottom:12px;">Use Google to sign in</td></tr>
          <tr><td style="font-size:15px;line-height:1.55;color:#b5b5b5;padding-bottom:24px;">
            Hi ${escapeHtml(first)}, this Intrisal account does not use a password. Sign in with Google instead.
          </td></tr>
          <tr><td style="padding-bottom:20px;">
            <a href="${escapeHtml(input.loginUrl)}" style="display:inline-block;background:#ffffff;color:#000000;text-decoration:none;font-weight:650;font-size:15px;padding:12px 20px;border-radius:999px;">
              Go to sign in
            </a>
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  return { subject, html, text };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
