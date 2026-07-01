const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sendWelcome, sendOrderError, sendVerification } = require('./mailer');
const { PORT, ADMIN_USER, ADMIN_PASS } = require('./config');
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

// ── Read-only admin dashboard ────────────────────────────────────────────────
// Table names below are a fixed whitelist, never taken from the request —
// only their validated keys ever reach a query string.
const ADMIN_PAGE_SIZE = 50;
const ADMIN_TABLES = {
  users: {
    label: 'Users', orderBy: 'id DESC',
    columns: ['id', 'email', 'player_name', 'delivery_hour_utc', 'verified', 'current_tier',
      'day_in_tier', 'verification_token', 'verification_expires', 'pending_tax', 'pending_grain',
      'pending_buy', 'pending_sell', 'pending_tier', 'pending_treasury'],
  },
  player_states: {
    label: 'Player States', orderBy: 'user_id DESC',
    columns: ['user_id', 'city_name', 'population', 'treasury', 'grain_stored', 'public_anger',
      'growth_streak', 'happy_streak', 'next_grain_price', 'next_grain_sell_price'],
  },
  turn_history: {
    label: 'Turn History', orderBy: 'id DESC',
    columns: ['id', 'user_id', 'city_name', 'tier', 'year_in_tier', 'tax_rate', 'grain_ordered',
      'grain_actual', 'grain_bought', 'grain_sold', 'pop_start', 'pop_end', 'starved',
      'treasury_start', 'treasury_end', 'grain_start', 'grain_end', 'anger_start', 'anger_end',
      'events', 'created_at'],
  },
  level_config: {
    label: 'Level Config', orderBy: 'level_id ASC',
    columns: ['level_id', 'rank_title', 'term_years', 'start_population', 'start_grain',
      'start_treasury', 'start_anger', 'harvest_multiplier', 'disaster_risk', 'growth_threshold'],
  },
  city_names: {
    label: 'City Names', orderBy: 'id ASC',
    columns: ['id', 'tier', 'name'],
  },
};

// Maps sortable player-view column names to their qualified SQL column —
// only keys in this map are ever accepted as a sort column.
const PLAYERS_SORT_COLUMNS = {
  id: 'u.id', email: 'u.email', player_name: 'u.player_name', verified: 'u.verified',
  current_tier: 'u.current_tier', rank_title: 'lc.rank_title', day_in_tier: 'u.day_in_tier',
  city_name: 'ps.city_name', population: 'ps.population', treasury: 'ps.treasury',
  grain_stored: 'ps.grain_stored', public_anger: 'ps.public_anger', pending_tax: 'u.pending_tax',
  pending_grain: 'u.pending_grain', pending_buy: 'u.pending_buy', pending_sell: 'u.pending_sell',
  pending_tier: 'u.pending_tier',
};

function resolveOrderBy(sortColumns, sortCol, sortDir, defaultOrderBy) {
  const dir = sortDir === 'desc' ? 'DESC' : sortDir === 'asc' ? 'ASC' : null;
  if (dir && sortCol && Object.prototype.hasOwnProperty.call(sortColumns, sortCol)) {
    return `${sortColumns[sortCol]} ${dir}`;
  }
  return defaultOrderBy;
}

function checkAdminAuth(req) {
  if (!ADMIN_USER || !ADMIN_PASS) return false;
  const header = req.headers['authorization'] || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  let decoded;
  try { decoded = Buffer.from(encoded, 'base64').toString('utf8'); } catch { return false; }
  const idx = decoded.indexOf(':');
  if (idx === -1) return false;
  const user = Buffer.from(decoded.slice(0, idx));
  const pass = Buffer.from(decoded.slice(idx + 1));
  const expectedUser = Buffer.from(ADMIN_USER);
  const expectedPass = Buffer.from(ADMIN_PASS);
  const userOk = user.length === expectedUser.length && crypto.timingSafeEqual(user, expectedUser);
  const passOk = pass.length === expectedPass.length && crypto.timingSafeEqual(pass, expectedPass);
  return userOk && passOk;
}

function requireAdminAuth(req, res) {
  if (checkAdminAuth(req)) return true;
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Plebs Control Admin"' });
  res.end('Authentication required');
  return false;
}

async function handleAdminPlayers(res, page, sortCol, sortDir) {
  const offset = (page - 1) * ADMIN_PAGE_SIZE;
  const orderBy = resolveOrderBy(PLAYERS_SORT_COLUMNS, sortCol, sortDir, 'u.id DESC');
  const totalRow = await dbGet('SELECT COUNT(*) AS c FROM users');
  const rows = await dbAll(
    `SELECT u.id, u.email, u.player_name, u.verified, u.current_tier, lc.rank_title,
            u.day_in_tier, ps.city_name, ps.population, ps.treasury, ps.grain_stored,
            ps.public_anger, u.pending_tax, u.pending_grain, u.pending_buy, u.pending_sell,
            u.pending_tier
     FROM users u
     LEFT JOIN player_states ps ON ps.user_id = u.id
     LEFT JOIN level_config lc  ON lc.level_id = u.current_tier
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
    [ADMIN_PAGE_SIZE, offset]
  );
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ rows, page, pageSize: ADMIN_PAGE_SIZE, total: totalRow.c }));
}

async function handleAdminTable(res, name, page, sortCol, sortDir) {
  const table = ADMIN_TABLES[name];
  if (!table) { res.writeHead(404); res.end('Unknown table'); return; }
  const sortColumns = Object.fromEntries(table.columns.map(c => [c, c]));
  const orderBy = resolveOrderBy(sortColumns, sortCol, sortDir, table.orderBy);
  const offset = (page - 1) * ADMIN_PAGE_SIZE;
  const totalRow = await dbGet(`SELECT COUNT(*) AS c FROM ${name}`);
  const rows = await dbAll(
    `SELECT * FROM ${name} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [ADMIN_PAGE_SIZE, offset]
  );
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ rows, page, pageSize: ADMIN_PAGE_SIZE, total: totalRow.c }));
}

async function handleAdminRequest(req, res, pathname, page, sortCol, sortDir) {
  if (!requireAdminAuth(req, res)) return;

  if (pathname === '/api/admin') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (e) {
      console.error('[admin]', e);
      res.writeHead(500); res.end('Error');
    }
    return;
  }

  if (pathname === '/api/admin/players') {
    try { await handleAdminPlayers(res, page, sortCol, sortDir); } catch (e) {
      console.error('[admin]', e); res.writeHead(500); res.end('Error');
    }
    return;
  }

  const tableMatch = pathname.match(/^\/api\/admin\/table\/([a-z_]+)$/);
  if (tableMatch) {
    try { await handleAdminTable(res, tableMatch[1], page, sortCol, sortDir); } catch (e) {
      console.error('[admin]', e); res.writeHead(500); res.end('Error');
    }
    return;
  }

  res.writeHead(404); res.end('Not found');
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    setCORS(res); res.writeHead(204); res.end(); return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/admin')) {
    const u = new URL(req.url, 'http://localhost');
    const page = Math.max(1, parseInt(u.searchParams.get('page'), 10) || 1);
    const sortCol = u.searchParams.get('sort');
    const sortDir = u.searchParams.get('dir');
    await handleAdminRequest(req, res, u.pathname, page, sortCol, sortDir);
    return;
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
