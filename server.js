const http = require('http');
const crypto = require('crypto');
const { sendWelcome, sendOrderError, sendVerification } = require('./mailer');
const { PORT } = require('./config');
const { dbGet, dbAll, dbRun } = require('./db');

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
    'SELECT name FROM city_names WHERE tier = 1 ORDER BY RAND() LIMIT 1'
  );
  const cityName = cityRow ? cityRow.name : 'Vindolanda';

  await dbRun(
    `UPDATE users SET verified = 1, verification_token = NULL, verification_expires = NULL WHERE id = ?`,
    [user.id]
  );
  await dbRun(
    `INSERT IGNORE INTO player_states
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
    'SELECT name FROM city_names WHERE tier = ? ORDER BY RAND() LIMIT 1', [tier]
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
  const sellMatch  = body.match(/SELL:\s*(\d+)/i);
  const sellAmount = sellMatch ? parseInt(sellMatch[1], 10) : 0;

  await dbRun(
    `UPDATE users SET pending_tax = ?, pending_grain = ?, pending_buy = ?, pending_sell = ? WHERE id = ?`,
    [taxRate, grainAmount, buyAmount, sellAmount, user.id]
  );
  console.log(`[inbound] orders stored for ${from}: TAX:${taxRate} GRAIN:${grainAmount} BUY:${buyAmount} SELL:${sellAmount}`);
  return { status: 200, message: 'Orders received' };
}

// Requires a local part, an "@", a domain label, and a TLD of at least 2
// letters — rejects junk like "blah@.com" or "blah@bad" while staying
// simple (no claim to full RFC 5322 compliance).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

async function handleSignup(payload) {
  const email = String(payload.email || '').trim().toLowerCase();
  const playerName = String(payload.name || '').trim();
  let deliveryHour = parseInt(payload.deliveryHour, 10);
  if (!(deliveryHour >= 0 && deliveryHour <= 23)) deliveryHour = 12;

  if (!playerName) {
    return { status: 400, message: 'A name is required.' };
  }
  if (!EMAIL_RE.test(email)) {
    return { status: 400, message: 'That does not look like a valid email address.' };
  }

  const existing = await dbGet('SELECT id FROM users WHERE LOWER(email) = ?', [email]);
  if (existing) {
    return { status: 409, message: 'A player with that email already exists.' };
  }

  const token = crypto.randomBytes(16).toString('hex');
  const expires = Date.now() + 24 * 60 * 60 * 1000;

  await dbRun(
    `INSERT INTO users (email, player_name, delivery_hour_utc, verified, verification_token, verification_expires)
     VALUES (?, ?, ?, 0, ?, ?)`,
    [email, playerName, deliveryHour, token, expires]
  );

  await sendVerification(email, playerName);
  console.log(`[signup] ${email} (${playerName}) → verification sent`);
  return { status: 200, message: 'Verification email sent — check your inbox.' };
}

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function handleLegions(res) {
  const rows = await dbAll(
    `SELECT u.id, u.player_name, lc.rank_title, u.current_tier,
            ps.city_name, ps.population, ps.treasury, ps.grain_stored
     FROM users u
     JOIN player_states ps ON ps.user_id = u.id
     JOIN level_config lc  ON lc.level_id = u.current_tier
     WHERE u.verified = 1
     ORDER BY u.current_tier DESC, ps.population DESC`
  );
  const payload = rows.map((r, i) => ({ ...r, rank: i + 1 }));
  setCORS(res);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    setCORS(res); res.writeHead(204); res.end(); return;
  }

  if (req.method === 'GET' && req.url === '/api/legions') {
    try { await handleLegions(res); } catch (e) {
      console.error('[legions]', e);
      res.writeHead(500); res.end('Error');
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/signup') {
    let signupBody = '';
    req.on('data', chunk => { signupBody += chunk; });
    req.on('end', async () => {
      setCORS(res);
      try {
        const payload = JSON.parse(signupBody);
        const result = await handleSignup(payload);
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: result.message }));
      } catch (err) {
        console.error('[signup] error:', err);
        res.writeHead(500); res.end('Error');
      }
    });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/inbound') {
    res.writeHead(404); res.end('Not found'); return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const ct = req.headers['content-type'] || '';
      let payload;
      if (ct.includes('application/json')) {
        payload = JSON.parse(body);
      } else {
        // Mailgun inbound: form-encoded with different field names
        const params = new URLSearchParams(body);
        const from = params.get('from') || params.get('sender') || '';
        const emailMatch = from.match(/<([^>]+)>/);
        payload = {
          from: emailMatch ? emailMatch[1] : from,
          text: params.get('stripped-text') || params.get('body-plain') || '',
        };
      }
      const result = await handleInbound(payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('[inbound] error:', err);
      res.writeHead(500); res.end('Error');
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[server] Inbound webhook listening on http://localhost:${PORT}/inbound`);
});
