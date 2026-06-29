const readline = require('readline');
const crypto = require('crypto');
const { sendVerification, sendWelcome } = require('./mailer');
const { processTurn } = require('./engine');
const { dbGet, dbRun, close } = require('./db');
const TEST_EMAIL = 'imtest@gmail.com';

const { toRoman, randomGreeting, pick, fmt, arrow, bar, CITY_MAPS, CAESAR_ART } = require('./helpers');
const { DISASTER_EVENTS } = require('./engine');


function displayCityMap(tier) {
  const lines = CITY_MAPS[tier - 1];
  if (!lines) return;
  console.log('');
  for (const line of lines) console.log(line);
  console.log('');
}

// ------- Input reader (works with both TTY and piped stdin) -------

class LineReader {
  constructor() {
    this._buffer = [];
    this._waiters = [];
    this._closed = false;

    const rl = readline.createInterface({ input: process.stdin, terminal: false });

    rl.on('line', (line) => {
      if (this._waiters.length > 0) {
        this._waiters.shift()(line);
      } else {
        this._buffer.push(line);
      }
    });

    rl.on('close', () => {
      this._closed = true;
      while (this._waiters.length > 0) this._waiters.shift()(null);
    });
  }

  read(promptText) {
    process.stdout.write(promptText);
    if (this._buffer.length > 0) return Promise.resolve(this._buffer.shift());
    if (this._closed) return Promise.resolve(null);
    return new Promise((resolve) => this._waiters.push(resolve));
  }
}

// ------- Migrations -------

async function migrate() {
  for (const sql of [
    `ALTER TABLE player_states ADD COLUMN growth_streak INTEGER DEFAULT 0`,
    `ALTER TABLE player_states ADD COLUMN happy_streak INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN verification_token TEXT`,
    `ALTER TABLE users ADD COLUMN verification_expires INTEGER`,
    `ALTER TABLE users ADD COLUMN pending_tax INTEGER`,
    `ALTER TABLE users ADD COLUMN pending_grain INTEGER`,
    `ALTER TABLE users ADD COLUMN pending_buy INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN pending_tier INTEGER`,
    `ALTER TABLE users ADD COLUMN pending_treasury INTEGER`,
    `ALTER TABLE player_states ADD COLUMN next_grain_price INTEGER DEFAULT 2`,
  ]) {
    try { await dbRun(sql); } catch (_) { /* column already exists */ }
  }
  await dbRun(`CREATE TABLE IF NOT EXISTS turn_history (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL,
    city_name        TEXT    NOT NULL,
    tier             INTEGER NOT NULL,
    year_in_tier     INTEGER NOT NULL,
    tax_rate         INTEGER NOT NULL,
    grain_ordered    INTEGER NOT NULL,
    grain_actual     INTEGER NOT NULL,
    grain_bought     INTEGER NOT NULL DEFAULT 0,
    pop_start        INTEGER NOT NULL,
    pop_end          INTEGER NOT NULL,
    starved          INTEGER NOT NULL DEFAULT 0,
    treasury_start   INTEGER NOT NULL,
    treasury_end     INTEGER NOT NULL,
    grain_start      INTEGER NOT NULL,
    grain_end        INTEGER NOT NULL,
    anger_start      INTEGER NOT NULL,
    anger_end        INTEGER NOT NULL,
    events           TEXT    NOT NULL DEFAULT '[]',
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
}

// ------- Game data -------

async function getState() {
  return dbGet(
    `SELECT u.id, u.current_tier, u.day_in_tier, u.player_name,
            ps.city_name, ps.population, ps.treasury, ps.grain_stored, ps.public_anger,
            ps.growth_streak, ps.happy_streak,
            lc.rank_title, lc.term_years, lc.start_population, lc.harvest_multiplier, lc.disaster_risk, lc.growth_threshold
     FROM users u
     JOIN player_states ps ON u.id = ps.user_id
     JOIN level_config lc ON u.current_tier = lc.level_id
     WHERE u.email = ?`,
    [TEST_EMAIL]
  );
}

async function getLevelConfig(levelId) {
  return dbGet(`SELECT * FROM level_config WHERE level_id = ?`, [levelId]);
}

async function saveTurnHistory(h) {
  await dbRun(
    `INSERT INTO turn_history
       (user_id, city_name, tier, year_in_tier,
        tax_rate, grain_ordered, grain_actual, grain_bought,
        pop_start, pop_end, starved,
        treasury_start, treasury_end,
        grain_start, grain_end,
        anger_start, anger_end, events)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      h.userId, h.cityName, h.tier, h.yearInTier,
      h.taxRate, h.grainOrdered, h.grainActual, h.grainBought,
      h.popStart, h.popEnd, h.starved,
      h.treasuryStart, h.treasuryEnd,
      h.grainStart, h.grainEnd,
      h.angerStart, h.angerEnd,
      JSON.stringify(h.events),
    ]
  );
}

async function saveState(state) {
  await dbRun(
    `UPDATE users SET current_tier = ?, day_in_tier = ? WHERE id = ?`,
    [state.current_tier, state.day_in_tier, state.id]
  );
  await dbRun(
    `UPDATE player_states SET city_name = ?, population = ?, treasury = ?, grain_stored = ?, public_anger = ?, growth_streak = ?, happy_streak = ?
     WHERE user_id = ?`,
    [state.city_name, state.population, state.treasury, state.grain_stored, state.public_anger,
     state.growth_streak || 0, state.happy_streak || 0, state.id]
  );
}

async function getRandomCityForTier(tier) {
  const row = await dbGet(
    `SELECT name FROM city_names WHERE tier = ? ORDER BY RANDOM() LIMIT 1`,
    [tier]
  );
  return row ? row.name : 'Unknown';
}

function address(state) { return `${state.rank_title} ${state.player_name}`; }

// ------- Treasury taunts on overthrow -------

function treasuryTaunt(treasury, name) {
  if (treasury >= 20000) {
    return pick([
      `Money is not everything, ${name}! Caesar eyes your bulging coffers with envy — but even gold cannot quiet a mob.`,
      `A full treasury and an empty throne. Caesar will gladly inherit your wealth!`,
      `Your coins were many, ${name}, but your plebs did not eat gold. Priorities!`,
      `Rich in denarii, poor in judgment. Caesar thanks you for the generous donation.`,
      `You hoarded gold while your people seethed. The mob took the city; Caesar took the rest.`,
    ]);
  }
  if (treasury >= 1000) {
    return pick([
      `You leave behind a modest purse. Caesar is... underwhelmed.`,
      `Neither rich enough to bribe them, nor poor enough for their pity. Well done, ${name}.`,
      `A middling fortune lost to a middling revolt. Truly, a legacy for the ages.`,
      `Caesar counts your coins and sighs. He expected more from you, ${name}.`,
      `Some denarii, some chaos, zero dignity. An average ending for an average ruler.`,
    ]);
  }
  return pick([
    `Broke AND overthrown, ${name}. Caesar is furious — you owe him money.`,
    `The mob chases you through the streets. Caesar's debt collectors are right behind them.`,
    `Not only did you lose the city, you left Caesar's treasury bare. Run fast, ${name}.`,
    `Penniless and powerless. Caesar sends his regards — and his bill.`,
    `No coins, no city, no dignity. Caesar has entered your name in the ledger of shame.`,
  ]);
}

// ------- Display -------

function displayStats(state, grainPrice, prev) {
  const p = prev || {};
  console.log('═'.repeat(58));
  console.log(`  🏛️  PLEBS CONTROL  |  ${state.rank_title}`);
  console.log(`  City: ${state.city_name.padEnd(20)}  Year ${toRoman(state.day_in_tier)} of ${toRoman(state.term_years)}`);
  console.log('─'.repeat(58));
  console.log(`  👥 Population : ${fmt(state.population).padStart(12)}${arrow(state.population, p.population)}`);
  console.log(`  🌾 Grain      : ${fmt(state.grain_stored).padStart(12)}${arrow(state.grain_stored, p.grain_stored)}`);
  console.log(`     Feed Need  : ${fmt(state.population * 20).padStart(12)}  (pop × 20)`);
  console.log(`  🪙 Treasury   : ${fmt(state.treasury).padStart(12)}${arrow(state.treasury, p.treasury)}`);
  console.log(`  📈 Mkt Price  : ${fmt(grainPrice).padStart(12)}  denarii/grain`);
  console.log(`  😠 Anger      : ${fmt(state.public_anger).padStart(12)}${arrow(state.public_anger, p.public_anger)}  ${bar(state.public_anger, 100)}`);
  console.log('═'.repeat(58));
}

// ------- Main loop -------

async function main() {
  await migrate();
  const reader = new LineReader();
  const TAX_RE   = /TAX:\s*(\d+)/i;
  const GRAIN_RE = /GRAIN:\s*(\d+)/i;
  const BUY_RE   = /BUY:\s*(\d+)/i;

  const intro = await getState();
  console.log(`\n  🏛️  Salve, ${address(intro)}! Welcome to PLEBS CONTROL`);
  console.log("  Rule your Roman city. Don't let them starve or revolt.\n");

  let prevState = null;
  while (true) {
    const state = await getState();
    const grainPrice = Math.floor(Math.random() * 4) + 1;
    displayStats(state, grainPrice, prevState);
    if (state.day_in_tier === 1) displayCityMap(state.current_tier);
    prevState = { population: state.population, grain_stored: state.grain_stored, treasury: state.treasury, public_anger: state.public_anger };

    if (state.population <= 0) {
      console.log(`\n  ☠️  GAME OVER — Vale, ${address(state)}. Your city has perished. The last pleb has died.\n`);
      break;
    }
    if (state.public_anger >= 100) {
      console.log(`\n  ⚔️  GAME OVER — Vale, ${address(state)}. The mob has risen. You have been overthrown.`);
      console.log(`  ${treasuryTaunt(state.treasury, state.player_name)}\n`);
      break;
    }

    const rawInput = await reader.read(`\n  Enter your orders > `);
    if (rawInput === null) break;

    const taxMatch   = rawInput.match(TAX_RE);
    const grainMatch = rawInput.match(GRAIN_RE);
    if (!taxMatch || !grainMatch) {
      console.log('  📜 The Scribe is bewildered. By Juno! Use format: TAX: [number] GRAIN: [number] BUY: [number](optional)');
      continue;
    }

    console.log(`\n  ${randomGreeting()}, ${address(state)}!`);

    const taxRate        = parseInt(taxMatch[1], 10);
    const grainDistributed = parseInt(grainMatch[1], 10);
    const buyMatch       = rawInput.match(BUY_RE);
    const buyAmount      = buyMatch ? parseInt(buyMatch[1], 10) : 0;

    const snapPop = state.population;
    const snapTreasury = state.treasury;
    const snapGrain = state.grain_stored;
    const snapAnger = state.public_anger;

    if (buyAmount > 0) {
      const cost = buyAmount * grainPrice;
      if (cost > state.treasury) {
        console.log(`\n  💸 Not enough denarii! ${buyAmount} grain costs ${cost} denarii — your treasury holds only ${fmt(state.treasury)}.`);
        continue;
      }
      state.treasury -= cost;
      state.grain_stored += buyAmount;
      console.log(`\n  🛒 Purchased ${fmt(buyAmount)} grain for ${fmt(cost)} denarii (${grainPrice} denarii/grain).`);
    }

    const updated = processTurn(state, taxRate, grainDistributed);

    await saveTurnHistory({
      userId: state.id, cityName: state.city_name,
      tier: state.current_tier, yearInTier: state.day_in_tier,
      taxRate, grainOrdered: grainDistributed,
      grainActual: Math.min(grainDistributed, state.grain_stored),
      grainBought: buyAmount,
      popStart: snapPop, popEnd: updated.population, starved: updated._starved,
      treasuryStart: snapTreasury, treasuryEnd: updated.treasury,
      grainStart: snapGrain, grainEnd: updated.grain_stored,
      angerStart: snapAnger, angerEnd: updated.public_anger,
      events: updated._events,
    });

    if (updated._grainCapped) {
      console.log(`\n  ⚠️  [Silo] Only ${fmt(state.grain_stored)} grain available — distribution capped. Pay attention to your stores!`);
    }
    if (updated._starved > 0) {
      console.log(`\n  💀 [Famine] ${fmt(updated._starved)} plebs starved this year. The gods are displeased.`);
    }
    for (const ev of updated._events) {
      if (ev.type === 'disaster') {
        console.log(`\n  ⚠️  [${ev.label}] Your silos have been ${ev.verb}. ${fmt(ev.grainLost)} grain lost.`);
      } else if (ev.type === 'sickness') {
        console.log(`\n  🤒 [Sickness] A plague sweeps through ${ev.city}. ${fmt(ev.popLost)} citizens perished.`);
      } else if (ev.type === 'caesars_favor') {
        console.log(`\n  🏛️  [Caesar's Favor] Caesar grants you a bounty of ${fmt(ev.amount)} denarii for your stewardship.`);
      } else if (ev.type === 'senatorial_scrutiny') {
        console.log(`\n  📜 [Senatorial Scrutiny] The Senate finds your lack of productivity disturbing. A fine of 50,000 denarii has been levied.`);
      } else if (ev.type === 'boom_town') {
        const angerNote = ev.angerReduced > 0 ? ` (-${ev.angerReduced} Anger)` : '';
        console.log(`\n  📈 [Boom Town] The city is thriving and expanding! The plebs are optimistic.${angerNote}`);
      }
    }

    updated.day_in_tier = state.day_in_tier + 1;

    // Check lose conditions after processing
    if (updated.population <= 0) {
      await saveState(updated);
      console.log(`\n  ☠️  GAME OVER — Vale, ${address(updated)}. Your city has perished. The last pleb has died.\n`);
      break;
    }
    if (updated.public_anger >= 100) {
      await saveState(updated);
      console.log(`\n  ⚔️  GAME OVER — Vale, ${address(updated)}. The mob has risen. You have been overthrown.`);
      console.log(`  ${treasuryTaunt(updated.treasury, updated.player_name)}\n`);
      break;
    }
    if (updated._exiled) {
      await saveState(updated);
      console.log(`\n  💀 [Senatorial Exile] You have reduced ${updated.city_name} to a desolate ghost town. The Senate has stripped you of your rank, seized your treasury, and banished you.\n`);
      break;
    }

    // Check level completion
    if (state.day_in_tier >= state.term_years) {
      const nextConfig = await getLevelConfig(state.current_tier + 1);

      // Thriving Metropolis: survived the term with population at or above the starting level
      if (updated.population >= state.start_population) {
        updated.treasury = Math.floor(updated.treasury * 1.5);
        console.log(`\n  🏛️  [Roman Triumph] You not only survived, but you grew the city! Caesar has declared a Triumph in your honor. Treasury increased by 50%!`);
      }

      if (nextConfig) {
        const newCity = await getRandomCityForTier(nextConfig.level_id);
        updated.current_tier = nextConfig.level_id;
        updated.day_in_tier = 1;
        updated.city_name = newCity;
        updated.population = nextConfig.start_population;
        updated.grain_stored = nextConfig.start_grain;
        updated.treasury = nextConfig.start_treasury;
        updated.public_anger = nextConfig.start_anger;
        updated.growth_streak = 0;
        updated.happy_streak = 0;
        await saveState(updated);
        console.log(`\n  ⭐ Macte, ${address(state)}! PROMOTED to ${nextConfig.rank_title}!`);
        console.log(`  Ave, ${nextConfig.rank_title} ${state.player_name}! You now rule ${newCity}.\n`);
      } else {
        await saveState(updated);
        console.log(CAESAR_ART);
        console.log(`\n  🏆 Ave, Caesar! ${address(updated)}, you have conquered all of Rome!`);
        console.log(`  Roma aeterna bows before you. Your name shall echo through the ages.\n`);
        break;
      }

      continue;
    }

    await saveState(updated);
  }

  close();
}

// ------- Reset -------

async function resetGame(level) {
  await migrate();
  const config = await getLevelConfig(level);
  if (!config) {
    console.error(`No level_config found for level ${level}. Check your database.`);
    close();
    process.exit(1);
  }
  const cityName = await getRandomCityForTier(level);
  await dbRun(
    `UPDATE users SET current_tier = ?, day_in_tier = 1 WHERE email = ?`,
    [level, TEST_EMAIL]
  );
  await dbRun(
    `UPDATE player_states SET city_name = ?, population = ?, treasury = ?, grain_stored = ?, public_anger = ?, growth_streak = 0, happy_streak = 0
     WHERE user_id = (SELECT id FROM users WHERE email = ?)`,
    [cityName, config.start_population, config.start_treasury, config.start_grain, config.start_anger, TEST_EMAIL]
  );
  console.log(`Game reset to Level ${level} (${config.rank_title}).`);
  close();
}

// ------- Signup -------

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function signup(emailArg, nameArg) {
  await migrate();

  let email, playerName;

  if (emailArg && nameArg) {
    email = emailArg.trim().toLowerCase();
    playerName = nameArg.trim();
  } else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('\n  🏛️  PLEBS CONTROL — New Player Signup\n');
    email = (await ask(rl, '  Email address : ')).trim().toLowerCase();
    playerName = (await ask(rl, '  Player name   : ')).trim();
    rl.close();
  }

  if (!email || !playerName) {
    console.log('  Email and player name are required.'); close(); return;
  }

  const existing = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) {
    console.log(`\n  A player with that email already exists.`); close(); return;
  }

  const token = crypto.randomBytes(16).toString('hex');
  const expires = Date.now() + 24 * 60 * 60 * 1000;

  await dbRun(
    `INSERT INTO users (email, player_name, delivery_hour_utc, verified, verification_token, verification_expires)
     VALUES (?, ?, ?, 0, ?, ?)`,
    [email, playerName, new Date().getUTCHours(), token, expires]
  );

  await sendVerification(email, playerName);

  console.log(`\n  ✅ Verification email sent to ${email}.`);
  console.log(`  Check Mailpit at http://localhost:8025\n`);
  close();
}

// ------- Verify -------

async function verify(token) {
  await migrate();

  if (!token) {
    console.log('  Usage: node game.js --verify [token]'); close(); return;
  }

  const user = await dbGet(
    'SELECT * FROM users WHERE verification_token = ?', [token]
  );

  if (!user) {
    console.log('\n  ❌ Invalid or already-used verification token.\n'); close(); return;
  }
  if (Date.now() > user.verification_expires) {
    console.log('\n  ❌ This token has expired. Request a new signup.\n'); close(); return;
  }

  const cityName = await getRandomCityForTier(1);
  const levelConfig = await getLevelConfig(1);

  await dbRun(
    `UPDATE users SET verified = 1, verification_token = NULL, verification_expires = NULL WHERE id = ?`,
    [user.id]
  );
  await dbRun(
    `INSERT OR IGNORE INTO player_states (user_id, city_name, population, treasury, grain_stored, public_anger)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [user.id, cityName, levelConfig.start_population, levelConfig.start_treasury,
     levelConfig.start_grain, levelConfig.start_anger]
  );

  await sendWelcome(user.email, user.player_name, levelConfig.rank_title, cityName);

  console.log(`\n  ✅ ${user.player_name} verified! City assigned: ${cityName}`);
  console.log(`  Welcome email sent — check Mailpit at http://localhost:8025\n`);
  close();
}

// ------- Entry point -------

const args = process.argv.slice(2);
if (args[0] === '--resetGame') {
  const level = args[1] && /^\d+$/.test(args[1]) ? parseInt(args[1], 10) : 1;
  resetGame(level).catch((err) => { console.error('Reset failed:', err); process.exit(1); });
} else if (args[0] === '--signup') {
  signup(args[1], args[2]).catch((err) => { console.error('Signup failed:', err); process.exit(1); });
} else if (args[0] === '--verify') {
  verify(args[1]).catch((err) => { console.error('Verify failed:', err); process.exit(1); });
} else {
  main().catch((err) => { console.error('Fatal error:', err); process.exit(1); });
}
