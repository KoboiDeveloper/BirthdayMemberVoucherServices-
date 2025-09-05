require('dotenv').config();
const nodemailer = require('nodemailer');

async function main() {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: +process.env.SMTP_PORT,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 30_000,
    tls: { rejectUnauthorized: false }
  }, {
    logger: true,
    debug: true
  });

  transporter.on('error', err => console.error('SMTP Error:', err));

  try {
    await transporter.verify();
    console.log('SMTP ready to send');

    // contoh kirim satu email
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: 'herubaskoro2@gmail.com',
      subject: 'Test SMTP',
      text: 'Coba kirim email...',
    });
    console.log('Message sent:', info.messageId);
  } catch (e) {
    console.error('Error saat verifikasi/kirim:', e);
  }
}

main();
