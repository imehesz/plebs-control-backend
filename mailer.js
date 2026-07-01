const nodemailer = require('nodemailer');
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = require('./config');
const { toRoman, randomGreeting, fmt, arrow, bar, CITY_MAPS, CAESAR_ART } = require('./helpers');

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: false,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

const FROM = '"Plebs Control — Cursus Publicus" <dispatch@plebscontrol.com>';

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

async function sendWelcome(to, playerName, rankTitle, cityName, dispatchTime = '08:00 UTC') {
  const subject = `Plebs Control — Your Appointment, ${rankTitle} ${playerName}`;
  const text = [
    '══════════════════════════════════════════════════',
    '  SENATUS POPULUSQUE ROMANUS',
    '══════════════════════════════════════════════════',
    '',
    `AVE, ${rankTitle.toUpperCase()} ${playerName.toUpperCase()}!`,
    '',
    `By decree of the Senate and People of Rome, you`,
    `have been appointed ${rankTitle} of ${cityName}.`,
    '',
    'The citizens await your guidance. The legions',
    'stand ready. The grain stores are yours to command.',
    '',
    `Your first official dispatch will arrive at ${dispatchTime}.`,
    '',
    'SPQR — Roma Aeterna',
    '— The Office of the Cursus Publicus',
    '══════════════════════════════════════════════════',
  ].join('\n');

  await transporter.sendMail({ from: FROM, to, subject, text });
}

async function sendYearOneDispatch(to, state, grainPrice = 2, sellPrice = 1) {
  const { rank_title, player_name, city_name, term_years, current_tier,
          population, grain_stored, treasury, public_anger } = state;
  const subject = `Plebs Control — ${city_name}, Year I of ${toRoman(term_years)}`;

  const mapLines = CITY_MAPS[(current_tier - 1)] || CITY_MAPS[0];

  const L = [
    `  ${randomGreeting()}, ${rank_title} ${player_name}!`,
    '',
    ...mapLines,
    '',
    '═'.repeat(58),
    `  🏛️  PLEBS CONTROL  |  ${rank_title}`,
    `  City: ${city_name.padEnd(20)}  Year I of ${toRoman(term_years)}`,
    '─'.repeat(58),
    `  👥 Population : ${fmt(population).padStart(12)}`,
    `  🌾 Grain      : ${fmt(grain_stored).padStart(12)}`,
    `     Feed Need  : ${fmt(population * 20).padStart(12)}  (pop × 20)`,
    `  🪙 Treasury   : ${fmt(treasury).padStart(12)}`,
    `  😠 Anger      : ${fmt(public_anger).padStart(12)}  ${bar(public_anger, 100)}`,
    `  📈 Buy Price  : ${fmt(grainPrice).padStart(12)}  denarii/grain`,
    `  📉 Sell Price : ${fmt(sellPrice).padStart(12)}  denarii/grain`,
    '═'.repeat(58),
    '',
    `  Enter your orders for Year I:`,
    '  TAX: [number]  GRAIN: [number]  BUY: [number](optional)  SELL: [number](optional)',
  ];

  await transporter.sendMail({ from: FROM, to, subject, text: L.join('\n') });
}


async function sendDispatch(to, state, updated, orders, grainPrice, nextGrainPrice, sellPrice, nextSellPrice) {
  const { rank_title, player_name, city_name, term_years } = state;
  const year = state.day_in_tier;
  // Label the email as the year the player is now entering (year+1), except on the final year
  const displayYear = year < term_years ? year + 1 : year;
  const subject = `Plebs Control — ${city_name}, Year ${toRoman(displayYear)} of ${toRoman(term_years)}`;

  const L = [];

  // Greeting + stats panel — mirrors displayStats exactly
  L.push(`  ${randomGreeting()}, ${rank_title} ${player_name}!`);
  L.push('═'.repeat(58));
  L.push(`  🏛️  PLEBS CONTROL  |  ${rank_title}`);
  L.push(`  City: ${city_name.padEnd(20)}  Year ${toRoman(displayYear)} of ${toRoman(term_years)}`);
  L.push('─'.repeat(58));
  L.push(`  👥 Population : ${fmt(updated.population).padStart(12)}${arrow(updated.population, state.population)}`);
  L.push(`  🌾 Grain      : ${fmt(updated.grain_stored).padStart(12)}${arrow(updated.grain_stored, state.grain_stored)}`);
  L.push(`     Feed Need  : ${fmt(updated.population * 20).padStart(12)}  (pop × 20)`);
  L.push(`  🪙 Treasury   : ${fmt(updated.treasury).padStart(12)}${arrow(updated.treasury, state.treasury)}`);
  L.push(`  📈 Buy Price  : ${fmt(nextGrainPrice ?? grainPrice).padStart(12)}  denarii/grain`);
  L.push(`  📉 Sell Price : ${fmt(nextSellPrice ?? sellPrice).padStart(12)}  denarii/grain`);
  L.push(`  😠 Anger      : ${fmt(updated.public_anger).padStart(12)}${arrow(updated.public_anger, state.public_anger)}  ${bar(updated.public_anger, 100)}`);
  L.push('═'.repeat(58));

  // Events — same wording as CLI
  if (updated._grainCapped)
    L.push(`\n  ⚠️  [Silo] Only ${fmt(state.grain_stored)} grain available — distribution capped.`);
  if (orders.sellCapped)
    L.push(`\n  📉 [Market] Only ${fmt(orders.sellAmount)} grain could be sold after reserving this year's distribution.`);
  if (updated._starved > 0)
    L.push(`\n  💀 [Famine] ${fmt(updated._starved)} plebs starved this year. The gods are displeased.`);
  for (const ev of updated._events) {
    if (ev.type === 'disaster')
      L.push(`\n  ⚠️  [${ev.label}] Your silos have been ${ev.verb}. ${fmt(ev.grainLost)} grain lost.`);
    else if (ev.type === 'sickness')
      L.push(`\n  🤒 [Sickness] A plague sweeps through ${ev.city}. ${fmt(ev.popLost)} citizens perished.`);
    else if (ev.type === 'caesars_favor')
      L.push(`\n  🏛️  [Caesar's Favor] Caesar grants you a bounty of ${fmt(ev.amount)} denarii for your stewardship.`);
    else if (ev.type === 'senatorial_scrutiny')
      L.push(`\n  📜 [Senatorial Scrutiny] The Senate finds your lack of productivity disturbing. A fine of 50,000 denarii has been levied.`);
    else if (ev.type === 'boom_town' && ev.angerReduced > 0)
      L.push(`\n  📈 [Boom Town] The city is thriving and expanding! The plebs are optimistic. (-${ev.angerReduced} Anger)`);
    else if (ev.type === 'roman_triumph')
      L.push(`\n  🏆 [Roman Triumph] Your stewardship of ${city_name} has been declared a triumph! Treasury increased by 50%.`);
  }

  // Outcome footer
  if (updated._gameWon) {
    L.push(`\n${CAESAR_ART}`);
    L.push(`\n  AVE, PROCONSUL ${player_name}!`);
    L.push(`  You have conquered all seven provinces of Rome.`);
    L.push(`  Caesar himself demands your return to Roma.`);
    L.push(`\n  Your legend will be remembered for a thousand years.`);
    L.push(`  ROMA AETERNA — SPQR`);
    L.push(`\n  You have been returned to Tier I to begin again.`);
    L.push(`  Your next dispatch will arrive at the usual time.`);
  } else if (updated._exiled) {
    L.push(`\n  💀 [Senatorial Exile] You have reduced ${city_name} to a desolate ghost town.`);
    L.push(`  The Senate has stripped your rank. Watch for your reassignment letter.`);
  } else if (updated.population <= 0) {
    L.push(`\n  ☠️  GAME OVER — Vale, ${rank_title} ${player_name}. The last pleb has died.`);
    L.push(`  The Senate has stripped your rank. Watch for your reassignment letter.`);
  } else if (updated.public_anger >= 100) {
    L.push(`\n  ⚔️  GAME OVER — Vale, ${rank_title} ${player_name}. The mob has risen. You have been overthrown.`);
    L.push(`  The Senate has stripped your rank. Watch for your reassignment letter.`);
  } else if (year >= term_years) {
    L.push(`\n  ⭐ Your term in ${city_name} is complete. You'll be reassigned to a new city.`);
    L.push(`  Watch for your new assignment letter from the Senate.`);
  } else {
    L.push(`\n  Enter your orders for Year ${toRoman(year + 1)}:`);
    L.push('  TAX: [number]  GRAIN: [number]  BUY: [number](optional)  SELL: [number](optional)');
  }

  await transporter.sendMail({ from: FROM, to, subject, text: L.join('\n') });
}

async function sendAssignment(to, playerName, rankTitle, reason) {
  const subject = `Plebs Control — New Assignment: ${rankTitle}`;

  const intro = reason === 'promoted'
    ? `Your stewardship has impressed the Senate. You have been\npromoted to ${rankTitle}.`
    : reason === 'game_won'
    ? `Rome herself honours your name. Your legend is complete.\nThe Senate calls you back to serve once more, as ${rankTitle}.`
    : `The Senate has reviewed your term. You are being\nreassigned as ${rankTitle}.`;

  const text = [
    '══════════════════════════════════════════════════',
    '  SENATE OF ROME — NEW SENATORIAL ASSIGNMENT',
    '══════════════════════════════════════════════════',
    '',
    `Salve, ${playerName}.`,
    '',
    intro,
    '',
    'Reply to this email with the single word:',
    '',
    '  ACCEPT',
    '',
    '...to accept your appointment and receive your new city.',
    'Your daily dispatch will resume once you have accepted.',
    '',
    'SPQR',
    '— The Office of the Cursus Publicus',
    '══════════════════════════════════════════════════',
  ].join('\n');

  await transporter.sendMail({ from: FROM, to, subject, text });
}

async function sendOrderError(to, playerName, rankTitle, originalBody) {
  const subject = 'Plebs Control — Orders Not Received';
  const preview = originalBody
    ? originalBody.split('\n').slice(0, 5).map(l => `  > ${l}`).join('\n')
    : '  (no content)';
  const text = [
    '══════════════════════════════════════════════════',
    '  CURSUS PUBLICUS — MESSAGE COULD NOT BE PARSED',
    '══════════════════════════════════════════════════',
    '',
    `Salve, ${rankTitle} ${playerName}.`,
    '',
    'Your dispatch reached us but your orders could',
    'not be understood. Ensure your reply contains:',
    '',
    '  TAX: [0-50]',
    '  GRAIN: [amount]',
    '  BUY: [amount]   (optional)',
    '  SELL: [amount]  (optional)',
    '',
    'Example:',
    '  TAX: 10',
    '  GRAIN: 20000',
    '',
    'We received:',
    preview,
    '',
    'Reply again with the correct format to submit',
    'your orders before the next dispatch.',
    '',
    'SPQR',
    '— The Office of the Cursus Publicus',
    '══════════════════════════════════════════════════',
  ].join('\n');

  await transporter.sendMail({ from: FROM, to, subject, text });
}

module.exports = { sendVerification, sendWelcome, sendYearOneDispatch, sendDispatch, sendAssignment, sendOrderError };
