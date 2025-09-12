/*
 sendBirthdayEmails.js
 Node.js script to fetch birthday members and send them personalized emails
 Uses axios for HTTP requests, nodemailer for sending emails, and dotenv for configuration.

 Prerequisites:
  - .env:
      API_URL=...
      API_TOKEN=...                     // [ADD] opsional kalau mau lewat env
      SMTP_HOST=...
      SMTP_PORT=587
      SMTP_SECURE=false
      SMTP_USER=...
      SMTP_PASS=...
      SMTP_FROM="Your Company <no-reply@yourdomain.com>"
*/

require('dotenv').config();
const axios = require('axios');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

/** --------------------------------
 * Helpers
 * --------------------------------*/
function normalizeBrandToFileKey(brandRaw) {
  // [ADD] Normalisasi brand → nama file template (lowercase, spasi → underscore, alias brand)
  const s = String(brandRaw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

  const alias = {
    // contoh alias umum
    queensland: 'queensland', // kalau brand kamu "Queensland" tapi file "queensand.html"
  };
  return alias[s] || s;
}

/**
 * Fetch members whose birthday is today, along with voucher info.
 * Mengembalikan array member atau [] jika API bilang success tanpa data.
 */
 async function fetchMembers() {
  const apiUrl = process.env.API_URL;
  const token = process.env.API_TOKEN || '93564344792053024757076963936537'; // (tetap)

  if (!apiUrl) throw new Error('Missing API_URL in environment');
  if (!token) throw new Error('Missing API_TOKEN');

  const response = await axios.post(apiUrl, null, {
    params: { token },
    timeout: 15000,
  });

  const payload = response.data;

  if (process.env.DEBUG === 'true') {
    console.log('Raw API payload:', JSON.stringify(payload).slice(0, 500));
  }

  // Bentuk array langsung
  if (Array.isArray(payload)) return payload;

  // Bentuk umum { data: [...] }
  if (payload && Array.isArray(payload.data)) return payload.data;

  // Variasi lain
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && payload.data && Array.isArray(payload.data.items)) return payload.data.items;

  // Satu objek tunggal -> jadikan array
  if (payload && typeof payload === 'object' && !Array.isArray(payload) &&
      (payload.id_member || payload.email || payload.nama)) {
    return [payload];
  }

  // [ADD] API kadang hanya mengirim status sukses tanpa data
  if (payload && typeof payload === 'object' &&
      payload.status && /^success/i.test(String(payload.status)) &&
      !payload.data) {
    console.log('API success without data. Treat as 0 members.');
    return [];
  }

  // [ADD] Khusus pesan: "Tidak ada member yang ultang/ulang tahun"
  if (payload && typeof payload === 'object') {
    const texts = [payload.status, payload.message, payload.msg, payload.info]
      .filter(v => typeof v === 'string')
      .map(s => s.toLowerCase());

    const noBday = texts.some(t =>
      t.includes('tidak ada member') &&
      (t.includes('ultang tahun') || t.includes('ulang tahun'))
    );

    if (noBday) {
      console.log('API: Tidak ada member yang ulang tahun hari ini.'); // [ADD]
      return [];
    }
  }

  throw new Error('Unexpected API response format');
}


/**
 * Load the HTML template file for a given brand key (normalized).
 * Template filenames must match the normalized brand value plus .html
 */
function loadTemplate(brandKey) {
  // [CHG] parameter sekarang brandKey yang sudah dinormalisasi
  const fileName = `${brandKey}.html`;
  const templatePath = path.join(__dirname, 'templates', fileName);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${fileName}`);
  }
  return fs.readFileSync(templatePath, 'utf-8');
}

/**
 * Replace placeholders in template with member-specific values.
 * Dukung {{nama}}, {{kode_voucher}} / {{kodeVoucher}}, {{nominal_voucher}} / {{nominalVoucher}}
 */
function personalize(template, member) {
  // [FIX] dukung snake_case & camelCase
  const kodeVoucher = member.kode_voucher ?? member.kodeVoucher ?? '';
  const nominalVoucher = member.nominal_voucher ?? member.nominalVoucher ?? '';

  return template
    .replace(/{{\s*nama\s*}}/g, member.nama || '')
    .replace(/{{\s*(kode_voucher|kodeVoucher)\s*}}/g, String(kodeVoucher))
    .replace(/{{\s*(nominal_voucher|nominalVoucher)\s*}}/g, String(nominalVoucher));
}

/**
 * Send an email using a nodemailer transporter.
 * Attachment banner bersifat opsional (jika file ada).
 */
async function sendEmail(transporter, member, html, brandKey) {
  const attachments = [];
  // [ADD] lampiran banner opsional
  const bannerPath = path.join(__dirname, 'templates', 'banner', `${brandKey}.jpg`);
  if (fs.existsSync(bannerPath)) {
    attachments.push({
      filename: `${brandKey}.jpg`,
      path: bannerPath,
      cid: 'banner',
    });
  }

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: member.email,
    subject: `Selamat Ulang Tahun, ${member.nama || 'Member'}!`, // [CHG] fallback nama
    html,
    attachments, // [CHG]
  };
  return transporter.sendMail(mailOptions);
}

/**
 * Main execution
 */
(async () => {
  try {
    // 1. Fetch members
    const members = await fetchMembers();
    if (!members.length) {
      console.log('No birthday members found today.');
      return;
    }
    console.log(`Found ${members.length} member(s) with birthday today.`); // [ADD]

    // 2. Configure SMTP transporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // (opsional) verifikasi koneksi SMTP
    try {
      await transporter.verify(); // [ADD]
      console.log('SMTP connection verified.');
    } catch (vErr) {
      console.warn('SMTP verify failed (continuing):', vErr.message);
    }

    // 3. Loop through members and send emails
    for (const member of members) {
      try {
        // [FIX] dukung nama field brand versi snake/camel
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
