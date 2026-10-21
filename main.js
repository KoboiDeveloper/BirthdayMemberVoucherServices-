/*
 sendBirthdayEmails.js
 Node.js script to fetch birthday members and send them personalized emails.

 Env (Coolify Environment Variables / local .env):
   API_URL
   API_TOKEN
   SMTP_HOST
   SMTP_PORT
   SMTP_SECURE   // "true" | "false"
   SMTP_USER
   SMTP_PASS
   SMTP_FROM
   DEBUG         // optional "true"
*/

const fs = require('fs');
const path = require('path');

// Local only: load .env if present. Coolify already injects process.env —
// dotenv does not override existing vars by default.
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const axios = require('axios');
const nodemailer = require('nodemailer');

function env(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === '') {
    return fallback;
  }
  return String(v).trim();
}

function requireEnv(names) {
  const missing = names.filter((n) => !env(n));
  if (missing.length) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Set them in Coolify → Environment Variables (or local .env).'
    );
  }
}

function normalizeBrandToFileKey(brandRaw) {
  const s = String(brandRaw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

  const alias = {
    queensland: 'queensland',
  };
  return alias[s] || s;
}

/**
 * Fetch members whose birthday is today, along with voucher info.
 */
async function fetchMembers() {
  const apiUrl = env('API_URL');
  const token = env('API_TOKEN');

  let response;
  try {
    response = await axios.post(apiUrl, null, {
      params: { token },
      timeout: 15000,
      validateStatus: () => true, // handle non-2xx ourselves for clearer logs
    });
  } catch (err) {
    const detail = err.response
      ? `HTTP ${err.response.status}: ${typeof err.response.data === 'string' ? err.response.data : JSON.stringify(err.response.data)}`
      : err.message;
    throw new Error(`API_URL request failed (${apiUrl}): ${detail}`);
  }

  if (response.status >= 400) {
    const body =
      typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data);
    throw new Error(`API_URL returned HTTP ${response.status}: ${body}`);
  }

  const payload = response.data;

  if (env('DEBUG') === 'true') {
    console.log('Raw API payload:', JSON.stringify(payload).slice(0, 500));
  }

  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && payload.data && Array.isArray(payload.data.items)) return payload.data.items;

  if (
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    (payload.id_member || payload.email || payload.nama)
  ) {
    return [payload];
  }

  if (
    payload &&
    typeof payload === 'object' &&
    payload.status &&
    /^success/i.test(String(payload.status)) &&
    !payload.data
  ) {
    console.log('API success without data. Treat as 0 members.');
    return [];
  }

  if (payload && typeof payload === 'object') {
    const texts = [payload.status, payload.message, payload.msg, payload.info]
      .filter((v) => typeof v === 'string')
      .map((s) => s.toLowerCase());

    const noBday = texts.some(
      (t) =>
        t.includes('tidak ada member') &&
        (t.includes('ultang tahun') || t.includes('ulang tahun'))
    );

    if (noBday) {
      console.log('API: Tidak ada member yang ulang tahun hari ini.');
      return [];
    }
  }

  throw new Error('Unexpected API response format');
}

function loadTemplate(brandKey) {
  const fileName = `${brandKey}.html`;
  const templatePath = path.join(__dirname, 'templates', fileName);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${fileName}`);
  }
  return fs.readFileSync(templatePath, 'utf-8');
}

function personalize(template, member) {
  const kodeVoucher = member.kode_voucher ?? member.kodeVoucher ?? '';
  const nominalVoucher = member.nominal_voucher ?? member.nominalVoucher ?? '';

  return template
    .replace(/{{\s*nama\s*}}/g, member.nama || '')
    .replace(/{{\s*(kode_voucher|kodeVoucher)\s*}}/g, String(kodeVoucher))
    .replace(/{{\s*(nominal_voucher|nominalVoucher)\s*}}/g, String(nominalVoucher));
}

async function sendEmail(transporter, member, html, brandKey) {
  const attachments = [];
  const bannerPath = path.join(__dirname, 'templates', 'banner', `${brandKey}.jpg`);
  if (fs.existsSync(bannerPath)) {
    attachments.push({
      filename: `${brandKey}.jpg`,
      path: bannerPath,
      cid: 'banner',
    });
  }

  const mailOptions = {
    from: env('SMTP_FROM'),
    to: member.email,
    subject: `Selamat Ulang Tahun, ${member.nama || 'Member'}!`,
    html,
    attachments,
  };
  return transporter.sendMail(mailOptions);
}

(async () => {
  try {
    requireEnv([
      'API_URL',
      'API_TOKEN',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
      'SMTP_FROM',
    ]);

    console.log('Config OK. API_URL=', env('API_URL'));

    const members = await fetchMembers();
    if (!members.length) {
      console.log('No birthday members found today.');
      return;
    }
    console.log(`Found ${members.length} member(s) with birthday today.`);

    const transporter = nodemailer.createTransport({
      host: env('SMTP_HOST'),
      port: parseInt(env('SMTP_PORT'), 10),
      secure: env('SMTP_SECURE', 'false').toLowerCase() === 'true',
      auth: {
        user: env('SMTP_USER'),
        pass: env('SMTP_PASS'),
      },
    });

    try {
      await transporter.verify();
      console.log('SMTP connection verified.');
    } catch (vErr) {
      console.warn('SMTP verify failed (continuing):', vErr.message);
    }

    for (const member of members) {
      try {
        const brandRaw =
          member.brandTerbanyak ??
          member.brand_terbanyak ??
          member.brand ??
          '';
        const brandKey = normalizeBrandToFileKey(brandRaw);

        const template = loadTemplate(brandKey);
        const html = personalize(template, member);
        const info = await sendEmail(transporter, member, html, brandKey);
        console.log(`Email sent to ${member.email}: ${info.messageId || 'OK'}`);
      } catch (innerErr) {
        console.error(`Failed to send to ${member.email || '(unknown email)'}:`, innerErr);
      }
    }
  } catch (err) {
    console.error('Error in sending birthday emails:', err);
    process.exit(1);
  }
})();
