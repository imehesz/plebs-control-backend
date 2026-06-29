const http = require('http');
const { sendWelcome, sendOrderError } = require('./mailer');
const { PORT } = require('./config');
const { dbGet, dbRun } = require('./db');

// Strip quoted reply content — drop lines starting with '>' and everything after 'On ... wrote:'
function stripReply(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const result = [];
  for (const line of lines) {
    if (/^>/.test(line)) continue;
    if (/^On .+ wrote:/.test(line)) break;
    if (/^--\s*$/.test(line)) break;
    result.push(line);
  }
  return result.join('\n').trim();
}

async function handleAccept(user) {
  const levelConfig = await dbGet('SELECT * FROM level_config WHERE level_id = 1');
  const cityRow = await dbGet(
    'SELECT name FROM city_names WHERE tier = 1 ORDER BY RANDOM() LIMIT 1'
  );
  const cityName = cityRow ? cityRow.name : 'Vindolanda';

  await dbRun(
    `UPDATE users SET verified = 1, verification_token = NULL, verification_expires = NULL WHERE id = ?`,
    [user.id]
  );
  await dbRun(
    `INSERT OR IGNORE INTO player_states
       (user_id, city_name, population, treasury, grain_stored, public_anger)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [user.id, cityName, levelConfig.start_population, levelConfig.start_treasury,
     levelConfig.start_grain, levelConfig.start_anger]
  );

  const hour = String(user.delivery_hour_utc).padStart(2, '0');
  await sendWelcome(user.email, user.player_name, levelConfig.rank_title, cityName, `${hour}:00 UTC`);
  console.log(`[inbound] ACCEPT processed for ${user.email} → city: ${cityName}`);
}

async function handleNewAssignment(user) {
  const tier = user.pending_tier;
  const lc   = await dbGet('SELECT * FROM level_config WHERE level_id = ?', [tier]);
  const cityRow = await dbGet(
    'SELECT name FROM city_names WHERE tier = ? ORDER BY RANDOM() LIMIT 1', [tier]
  );
  const cityName = cityRow ? cityRow.name : `City`;
  const treasury = user.pending_treasury !== null && user.pending_treasury !== undefined
    ? user.pending_treasury
    : lc.start_treasury;

  await dbRun(
    `UPDATE users SET current_tier = ?, day_in_tier = 1,
     pending_tier = NULL, pending_treasury = NULL WHERE id = ?`,
    [tier, user.id]
  );
  await dbRun(
    `UPDATE player_states SET city_name = ?, population = ?, treasury = ?,
     grain_stored = ?, public_anger = ?, growth_streak = 0, happy_streak = 0
     WHERE user_id = ?`,
    [cityName, lc.start_population, treasury, lc.start_grain, lc.start_anger, user.id]
  );

  const hour = String(user.delivery_hour_utc).padStart(2, '0');
  await sendWelcome(user.email, user.player_name, lc.rank_title, cityName, `${hour}:00 UTC`);
  console.log(`[inbound] new assignment accepted for ${user.email} → L${tier} ${cityName}`);
}

async function handleInbound(payload) {
  const from = (payload.from || '').toLowerCase().trim();
  const body = stripReply(payload.text || '');
  const firstWord = body.split(/\s/)[0].toUpperCase();

  console.log(`[inbound] from=${from} firstWord=${firstWord}`);

  const user = await dbGet('SELECT * FROM users WHERE LOWER(email) = ?', [from]);
  if (!user) {
    console.log(`[inbound] no user found for ${from}`);
    return { status: 404, message: 'Unknown sender' };
  }

  // First-time signup verification
  if (!user.verified && firstWord === 'ACCEPT') {
    if (Date.now() > user.verification_expires) {
      console.log(`[inbound] token expired for ${from}`);
      return { status: 400, message: 'Verification expired' };
    }
    await handleAccept(user);
    return { status: 200, message: 'Verified' };
  }

  if (!user.verified) {
    console.log(`[inbound] unverified user sent non-ACCEPT reply: ${from}`);
    return { status: 400, message: 'Expected ACCEPT' };
  }

  // Verified player awaiting a new assignment
  if (user.pending_tier && firstWord === 'ACCEPT') {
    await handleNewAssignment(user);
    return { status: 200, message: 'Assignment accepted' };
  }

  // Verified player — parse game command (fields may be on separate lines)
  const taxMatch   = body.match(/TAX:\s*(\d+)/i);
  const grainMatch = body.match(/GRAIN:\s*(\d+)/i);
  if (!taxMatch || !grainMatch) {
    console.log(`[inbound] unrecognised command from ${from}: "${body}"`);
    const lc = await dbGet('SELECT rank_title FROM level_config WHERE level_id = ?', [user.current_tier]);
    await sendOrderError(user.email, user.player_name, lc ? lc.rank_title : '', body);
    return { status: 400, message: 'Could not parse TAX and GRAIN from reply' };
  }
  const taxRate   = parseInt(taxMatch[1], 10);
  const grainAmount = parseInt(grainMatch[1], 10);
  const buyMatch  = body.match(/BUY:\s*(\d+)/i);
  const buyAmount = buyMatch ? parseInt(buyMatch[1], 10) : 0;

  await dbRun(
    `UPDATE users SET pending_tax = ?, pending_grain = ?, pending_buy = ? WHERE id = ?`,
    [taxRate, grainAmount, buyAmount, user.id]
  );
  console.log(`[inbound] orders stored for ${from}: TAX:${taxRate} GRAIN:${grainAmount} BUY:${buyAmount}`);
  return { status: 200, message: 'Orders received' };
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/inbound') {
    res.writeHead(404); res.end('Not found'); return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const payload = JSON.parse(body);
      const result = await handleInbound(payload);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('[inbound] error:', err);
      res.writeHead(500); res.end('Error');
    }
  });
});

server.listen(PORT, () => {
  console.log(`[server] Inbound webhook listening on http://localhost:${PORT}/inbound`);
});
