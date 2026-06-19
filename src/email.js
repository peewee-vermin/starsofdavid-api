// src/email.js
// Stars of David — certificate delivery email
//
// Uses Resend (resend.com) — generous free tier, simple API,
// good deliverability. If RESEND_API_KEY is not set, emails are
// logged instead of sent, so the rest of the pipeline still works
// in development without an email provider configured.

const RESEND_API_URL = 'https://api.resend.com/emails';

const hasResend = Boolean(process.env.RESEND_API_KEY);

/**
 * Sends the certificate-of-dedication email to a donor.
 *
 * @param {Object} params
 * @param {string} params.to
 * @param {string} params.donorName
 * @param {string[]} params.starIds
 * @param {string[]} params.victimNames
 * @param {string} params.certificateUrl
 */
export async function sendCertificateEmail({ to, donorName, starIds, victimNames, certificateUrl }) {
  const subject = starIds.length === 1
    ? `A star has been named — ${victimNames[0] || starIds[0]}`
    : `${starIds.length} stars have been named in memory`;

  const html = renderEmailHtml({ donorName, starIds, victimNames, certificateUrl });

  if (!hasResend) {
    console.log('(no RESEND_API_KEY set — logging email instead of sending)');
    console.log(`To: ${to}\nSubject: ${subject}\nCertificate: ${certificateUrl}`);
    return { sent: false, logged: true };
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'Stars of David <dedications@stars-of-david.org>',
      to: [to],
      subject,
      html,
      attachments: [], // certificate is linked, not attached, to keep email size small
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend API error: ${res.status} ${errText}`);
  }

  return { sent: true, ...(await res.json()) };
}

function renderEmailHtml({ donorName, starIds, victimNames, certificateUrl }) {
  const starRows = starIds.map((id, i) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #2a2a35;color:#f0ede6;font-family:Georgia,serif;font-size:15px;">
        ${victimNames[i] || 'In memory'}
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #2a2a35;color:#c9a84c;font-family:Georgia,serif;font-size:13px;text-align:right;">
        ✦ ${id}
      </td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#07080f;font-family:Georgia,'Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07080f;padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <tr><td align="center" style="padding-bottom:24px;">
          <span style="color:#c9a84c;font-size:32px;">✦</span>
        </td></tr>
        <tr><td align="center" style="padding-bottom:8px;">
          <span style="color:#8a6f2e;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-family:Arial,sans-serif;">
            In Eternal Memory
          </span>
        </td></tr>
        <tr><td align="center" style="padding-bottom:32px;">
          <h1 style="color:#f0ede6;font-size:26px;font-weight:400;margin:0;font-style:italic;">
            ${starIds.length === 1 ? 'A star has been named.' : `${starIds.length} stars have been named.`}
          </h1>
        </td></tr>
        <tr><td style="padding-bottom:24px;color:#a89e8a;font-size:14px;line-height:1.7;">
          Dear ${donorName},<br><br>
          Thank you for your dedication. Your star${starIds.length > 1 ? 's are' : ' is'} now written in the
          Stars of David memorial registry, in eternal memory of:
        </td></tr>
        <tr><td style="padding-bottom:24px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            ${starRows}
          </table>
        </td></tr>
        <tr><td align="center" style="padding-bottom:32px;">
          <a href="${certificateUrl}" style="display:inline-block;background:#c9a84c;color:#07080f;text-decoration:none;padding:14px 32px;font-family:Arial,sans-serif;font-size:12px;letter-spacing:1px;text-transform:uppercase;">
            Download Your Certificate
          </a>
        </td></tr>
        <tr><td align="center" style="color:#5a5650;font-size:12px;font-family:Arial,sans-serif;padding-top:16px;border-top:1px solid #1a1c28;">
          stars-of-david.org<br>
          זִכְרוֹן לְבָרָכָה &nbsp;·&nbsp; May their memory be a blessing
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
  `.trim();
}

export const isEmailConfigured = hasResend;
