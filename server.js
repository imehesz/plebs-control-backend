const http = require('http');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { sendWelcome } = require('./mailer');

const DB_PATH = path.join(__dirname, 'plebs_control.db');
const PORT = 3000;

const db = new sqlite3.Database(DB_PATH);
function dbGet(sql, p = []) {
  return new Promise((res, rej) => db.get(sql, p, (e, r) => (e ? rej(e) : res(r))));
}
function dbRun(sql, p = []) {
  return new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
}

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

  await sendWelcome(user.email, user.player_name, levelConfig.rank_title, cityName);
  console.log(`[inbound] ACCEPT processed for ${user.email} → city: ${cityName}`);
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

  // Verified player — parse game command (fields may be on separate lines)
  const taxMatch   = body.match(/TAX:\s*(\d+)/i);
  const grainMatch = body.match(/GRAIN:\s*(\d+)/i);
  if (!taxMatch || !grainMatch) {
    console.log(`[inbound] unrecognised command from ${from}: "${body}"`);
    return { status: 400, message: 'Could not parse TAX and GRAIN from reply' };
  }
  const taxRate        = parseInt(taxMatch[1], 10);
  const grainAmount    = parseInt(grainMatch[1], 10);
  const buyMatch       = body.match(/BUY:\s*(\d+)/i);
  const buyAmount      = buyMatch ? parseInt(buyMatch[1], 10) : 0;
  console.log(`[inbound] orders from ${from}: TAX:${taxRate} GRAIN:${grainAmount} BUY:${buyAmount}`);
  return { status: 200, message: 'Orders received (turn processing not yet implemented)' };
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
