/*
 sendBirthdayEmails.js
 Node.js script to fetch birthday members and send them personalized emails
 Uses axios for HTTP requests, nodemailer for sending emails, and dotenv for configuration.

 Prerequisites:
  - Create a .env file with:
      API_URL=https://api.example.com/birthday-members
      SMTP_HOST=smtp.example.com
      SMTP_PORT=587
      SMTP_SECURE=false       # true if using TLS on port 465
      SMTP_USER=your_smtp_user
      SMTP_PASS=your_smtp_password
      SMTP_FROM="Your Company <no-reply@yourdomain.com>"

  - In a subfolder `templates`, place HTML templates named exactly:
      celcius.html
      celcius_woman.html
      mississippi.html
      queensand.html
    Each template can include placeholders: {{nama}}, {{kode_voucher}}, {{nominal_voucher}}

 Install dependencies:
   npm install axios nodemailer dotenv
*/

require('dotenv').config();
const axios = require('axios');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

/**
 * Fetch members whose birthday is today, along with voucher info.
 * Supports API responses that either return an array directly or an object:
 *   { status, timestamp, data: [ ... ] }
 * Returns an array of member objects:
 *   { id_member, nama, email, brand_terbanyak, kode_voucher, nominal_voucher }
 */
async function fetchMembers() {
  const apiUrl = process.env.API_URL;
  token = '93564344792053024757076963936537'
  if (!apiUrl) throw new Error('Missing API_URL in environment');
  if (!token) throw new Error('Missing API_TOKEN');

  const response = await axios.post(apiUrl,null, {
    params: { token }
  });
  const payload = response.data;


  // Determine if payload is already an array
  if (Array.isArray(payload)) {
    return payload;
  }
  // If wrapped in { data: [...] }
  if (payload && Array.isArray(payload.data)) {
    return payload.data;
  }
  throw new Error('Unexpected API response format');
}

/**
 * Load the HTML template file for a given brand.
 * Template filenames must match the lowercase brand_terbanyak value plus .html
 */
function loadTemplate(brand) {
  const fileName = `${brand.toLowerCase()}.html`;
  const templatePath = path.join(__dirname, 'templates', fileName);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${fileName}`);
  }
  return fs.readFileSync(templatePath, 'utf-8');
}

/**
 * Replace placeholders in template with member-specific values.
 */
function personalize(template, member) {
  return template
    .replace(/{{\s*nama\s*}}/g, member.nama)
    .replace(/{{\s*kodeVoucher\s*}}/g, member.kodeVoucher)
    .replace(/{{\s*nominalVoucher\s*}}/g, member.nominalVoucher);
}

/**
 * Send an email using a nodemailer transporter.
 */
async function sendEmail(transporter, member, html, brand) {
  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: member.email,
    subject: `Selamat Ulang Tahun, ${member.nama}!`,
    html: html,
      attachments: [
      {
        filename: `${brand}.jpg`,
        path: path.join(__dirname, 'templates/banner', `${brand}.jpg`),
        cid: 'banner'
      }
    ]
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

    // 3. Loop through members and send emails
    for (const member of members) {
      try {
        const brand = member.brandTerbanyak.toLowerCase();
        const template = loadTemplate(brand);
        const html = personalize(template, member);
        const info = await sendEmail(transporter, member, html,  member.brandTerbanyak.toLowerCase());
        console.log(`Email sent to ${member.email}: ${info.messageId}`);
      } catch (innerErr) {
        console.error(`Failed to send to ${member.email}:`, innerErr);
      }
    }
  } catch (err) {
    console.error('Error in sending birthday emails:', err);
    process.exit(1);
  }
})();
