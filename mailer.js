const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'localhost',
  port: 1025,
  secure: false,
  ignoreTLS: true,
});

const FROM = '"Plebs Control — Cursus Publicus" <dispatch@plebs-control.local>';

async function sendVerification(to, playerName) {
  const subject = 'Plebs Control — Confirm Your Senatorial Appointment';
  const text = [
    '══════════════════════════════════════════════════',
    '  SENATE OF ROME — OFFICE OF THE CURSUS PUBLICUS',
    '══════════════════════════════════════════════════',
    '',
    `Salve, ${playerName}!`,
    '',
    'Your petition to govern a Roman city has been',
    'received and is under review by the Senate.',
    '',
    'Reply to this email with the single word:',
    '',
    '  ACCEPT',
    '',
    '...to confirm your appointment as governor.',
    'This mandate expires in 24 hours.',
    '',
    'If you did not request this appointment,',
    'discard this message. The Senate is watching.',
    '',
    'SPQR',
    '— The Office of the Cursus Publicus',
    '══════════════════════════════════════════════════',
  ].join('\n');

  await transporter.sendMail({ from: FROM, to, subject, text });
}

async function sendWelcome(to, playerName, rankTitle, cityName) {
  const subject = `Plebs Control — Welcome, ${rankTitle} ${playerName}`;
  const text = [
    '══════════════════════════════════════════════════',
    '  SENATE OF ROME — OFFICIAL DISPATCH',
    '══════════════════════════════════════════════════',
    '',
    `Ave, ${rankTitle} ${playerName}!`,
    '',
    `The Senate has appointed you ${rankTitle} of`,
    `${cityName}. Your term begins immediately.`,
    '',
    'You will receive a dispatch from your city each day.',
    'Reply with your orders using this format:',
    '',
    '  TAX: [0-50]  GRAIN: [amount]  BUY: [amount]',
    '',
    'TAX is the rate levied on every citizen each year.',
    'At TAX: 15, a city of 1,000 earns 15,000 denarii.',
    'Too high and the mob grows restless. Too low and',
    'your treasury runs dry.',
    '',
    'GRAIN is the total you distribute to your people.',
    'Each citizen needs 20 units to survive the year.',
    'A city of 1,000 needs at least GRAIN: 20000 or',
    'people will starve — and blame you for it.',
    '',
    'BUY (optional) purchases grain from the market',
    'before distribution. Useful when your silos run',
    'low. The price changes each year.',
    '',
    'Example order for a city of 1,000:',
    '  TAX: 15  GRAIN: 20000  BUY: 5000',
    '',
    'A word of advice from your predecessors:',
    '  • Keep anger below 100 or face the mob.',
    '  • Feed your plebs or watch them starve.',
    '  • The Senate rewards growth. Deliver it.',
    '',
    'Roma is watching.',
    '',
    'SPQR — Roma Aeterna',
    '══════════════════════════════════════════════════',
  ].join('\n');

  await transporter.sendMail({ from: FROM, to, subject, text });
}

module.exports = { sendVerification, sendWelcome };
