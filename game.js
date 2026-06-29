const sqlite3 = require('sqlite3').verbose();
const readline = require('readline');
const path = require('path');

const DB_PATH = path.join(__dirname, 'plebs_control.db');
const TEST_EMAIL = 'imtest@gmail.com';

const TIER_NAMES = { 1: 'Probation (The Duumvir)', 2: 'Governance (The Governor)' };
const TIER_DURATIONS = { 1: 5, 2: 10 };

const ROMAN_NUMERALS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV'];
function toRoman(n) { return ROMAN_NUMERALS[n] || String(n); }

const GREETINGS = ['Salve', 'Ave', 'Salvete', 'Bene venisti', 'Io'];
function randomGreeting() { return GREETINGS[Math.floor(Math.random() * GREETINGS.length)]; }

const db = new sqlite3.Database(DB_PATH);

// ------- DB helpers -------

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
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

// ------- Game data -------

async function getState() {
  return dbGet(
    `SELECT u.id, u.current_tier, u.day_in_tier, u.player_name,
            ps.city_name, ps.population, ps.treasury, ps.grain_stored, ps.public_anger
     FROM users u
     JOIN player_states ps ON u.id = ps.user_id
     WHERE u.email = ?`,
    [TEST_EMAIL]
  );
}

const RANK_TITLES = { 1: 'Duumvir', 2: 'Governor' };
function rankTitle(tier) { return RANK_TITLES[tier] || `Tier ${tier}`; }
function address(state) { return `${rankTitle(state.current_tier)} ${state.player_name}`; }

async function saveState(state) {
  await dbRun(
    `UPDATE users SET current_tier = ?, day_in_tier = ? WHERE id = ?`,
    [state.current_tier, state.day_in_tier, state.id]
  );
  await dbRun(
    `UPDATE player_states SET city_name = ?, population = ?, treasury = ?, grain_stored = ?, public_anger = ?
     WHERE user_id = ?`,
    [state.city_name, state.population, state.treasury, state.grain_stored, state.public_anger, state.id]
  );
}

async function getRandomCityForTier(tier) {
  const row = await dbGet(
    `SELECT name FROM city_names WHERE tier = ? ORDER BY RANDOM() LIMIT 1`,
    [tier]
  );
  return row ? row.name : 'Unknown';
}

// ------- Treasury taunts on overthrow -------

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

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
  // broke
  return pick([
    `Broke AND overthrown, ${name}. Caesar is furious — you owe him money.`,
    `The mob chases you through the streets. Caesar's debt collectors are right behind them.`,
    `Not only did you lose the city, you left Caesar's treasury bare. Run fast, ${name}.`,
    `Penniless and powerless. Caesar sends his regards — and his bill.`,
    `No coins, no city, no dignity. Caesar has entered your name in the ledger of shame.`,
  ]);
}

// ------- Display -------

function bar(value, max, width = 20) {
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function displayStats(state, grainPrice) {
  const tier = state.current_tier;
  const duration = TIER_DURATIONS[tier] || '?';
  const tierName = TIER_NAMES[tier] || `Tier ${tier}`;

  console.log('\n' + '═'.repeat(52));
  console.log(`  🏛️  PLEBS CONTROL  |  ${tierName}`);
  console.log(`  City: ${state.city_name.padEnd(20)}  Year ${toRoman(state.day_in_tier)} of ${toRoman(duration)}`);
  console.log('─'.repeat(52));
  console.log(`  👥 Population : ${String(state.population).padStart(7)}  ${bar(state.population, 5000)}`);
  console.log(`  🌾 Grain      : ${String(state.grain_stored).padStart(7)}`);
  console.log(`  🪙 Treasury   : ${String(state.treasury).padStart(7)}`);
  console.log(`  📈 Mkt Price  : ${String(grainPrice).padStart(7)}  denarii/grain`);
  console.log(`  😠 Anger      : ${String(state.public_anger).padStart(7)}  ${bar(state.public_anger, 100)}`);
  console.log('═'.repeat(52));
}

// ------- Simulation -------

function populationGrowthRate(anger) {
  if (anger <= 5)  return  0.10;
  if (anger <= 10) return  0.05;
  if (anger <= 20) return  0.01;
  if (anger <= 30) return -0.05;
  if (anger <= 40) return -0.10;
  return -0.25; // 40-100
}

function processTurn(state, taxRate, grainDistributed) {
  let { population, treasury, grain_stored, public_anger, current_tier } = state;
  let starved = 0;
  let grainCapped = false;

  // Cap distribution at what's in the silo
  if (grainDistributed > grain_stored) {
    grainDistributed = grain_stored;
    grainCapped = true;
  }

  // 1. Starvation Phase
  const plebsFed = Math.floor(grainDistributed / 20);
  if (plebsFed < population) {
    starved = population - plebsFed;
    population = plebsFed;
  }

  // grainFed = grain actually consumed by the fed plebs
  const grainFed = population * 20;

  // 2. Treasury Phase
  treasury = treasury + taxRate * population;

  // 3. Harvest Phase
  const harvest = current_tier <= 2 ? population * 4 : population * 2;
  grain_stored = grain_stored - grainFed + harvest;

  // 4. Public Anger Phase
  const baseAnger = -5;
  let taxPenalty = Math.max(0, taxRate - 10);
  if (current_tier === 2) taxPenalty = taxPenalty * 1.2;
  const starvationPenalty = Math.min(40,
    population > 0 ? Math.floor((starved / population) * 100) : 100);

  public_anger = public_anger + baseAnger + taxPenalty + starvationPenalty;
  public_anger = Math.max(0, Math.min(100, Math.round(public_anger)));

  // 5. Population Growth/Shrink Phase (tiers 1 & 2)
  if (current_tier <= 2 && population > 0) {
    const rate = populationGrowthRate(public_anger);
    population = Math.max(0, Math.floor(population + population * rate));
  }

  return { ...state, population, treasury, grain_stored, public_anger, _starved: starved, _grainCapped: grainCapped };
}

// ------- Main loop -------

async function main() {
  const reader = new LineReader();
  const inputRegex = /TAX:\s*(\d+)\s+GRAIN:\s*(\d+)(?:\s+BUY:\s*(\d+))?/i;

  const intro = await getState();
  console.log(`\n  🏛️  Salve, ${address(intro)}! Welcome to PLEBS CONTROL`);
  console.log("  Rule your Roman city. Don't let them starve or revolt.\n");

  while (true) {
    const state = await getState();
    const grainPrice = Math.floor(Math.random() * 4) + 1;
    displayStats(state, grainPrice);

    if (state.population <= 0) {
      console.log(`\n  ☠️  GAME OVER — Vale, ${address(state)}. Your city has perished. The last pleb has died.\n`);
      break;
    }
    if (state.public_anger >= 100) {
      console.log(`\n  ⚔️  GAME OVER — Vale, ${address(state)}. The mob has risen. You have been overthrown.`);
      console.log(`  ${treasuryTaunt(state.treasury, state.player_name)}\n`);
      break;
    }

    const rawInput = await reader.read(`\n  ${randomGreeting()}, ${address(state)} — enter your orders > `);
    if (rawInput === null) break; // EOF / Ctrl+C

    const match = rawInput.match(inputRegex);
    if (!match) {
      console.log('  📜 The Scribe is bewildered. By Juno! Use format: TAX: [number] GRAIN: [number] BUY: [number](optional)');
      continue;
    }

    const taxRate = parseInt(match[1], 10);
    const grainDistributed = parseInt(match[2], 10);
    const buyAmount = match[3] ? parseInt(match[3], 10) : 0;

    if (buyAmount > 0) {
      const cost = buyAmount * grainPrice;
      if (cost > state.treasury) {
        console.log(`\n  💸 Not enough denarii! ${buyAmount} grain costs ${cost} denarii — your treasury holds only ${state.treasury}.`);
        continue;
      }
      state.treasury -= cost;
      state.grain_stored += buyAmount;
      console.log(`\n  🛒 Purchased ${buyAmount} grain for ${cost} denarii (${grainPrice} denarii/grain).`);
    }

    const updated = processTurn(state, taxRate, grainDistributed);

    if (updated._grainCapped) {
      console.log(`\n  ⚠️  [Silo] Only ${state.grain_stored} grain available — distribution capped. Pay attention to your stores!`);
    }
    if (updated._starved > 0) {
      console.log(`\n  💀 [Famine] ${updated._starved} plebs starved this year. The gods are displeased.`);
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

    // Check tier completion
    const tierDuration = TIER_DURATIONS[state.current_tier];
    if (state.day_in_tier >= tierDuration) {
      if (state.current_tier === 1) {
        const newCity = await getRandomCityForTier(2);
        updated.current_tier = 2;
        updated.day_in_tier = 1;
        updated.city_name = newCity;
        await saveState(updated);
        console.log(`\n  ⭐ Macte, ${address(state)}! PROMOTED — You have survived Probation!`);
        console.log(`  Ave, Governor ${state.player_name}! You now rule ${newCity}.\n`);
        continue;
      }

      if (state.current_tier === 2) {
        await saveState(updated);
        console.log(`\n  🏆 Io! Io! VICTORIA — ${address(updated)}, you have mastered Governance. Roma aeterna is pleased.\n`);
        break;
      }
    }

    await saveState(updated);
  }

  db.close();
}

async function resetGame() {
  await dbRun(
    `UPDATE users SET current_tier = 1, day_in_tier = 1 WHERE email = ?`,
    [TEST_EMAIL]
  );
  await dbRun(
    `UPDATE player_states SET city_name = 'Vindolanda', population = 1000, treasury = 0,
     grain_stored = 50000, public_anger = 20
     WHERE user_id = (SELECT id FROM users WHERE email = ?)`,
    [TEST_EMAIL]
  );
  console.log('Game reset to starting state.');
  db.close();
}

if (process.argv.includes('--resetGame')) {
  resetGame().catch((err) => { console.error('Reset failed:', err); process.exit(1); });
} else {
  main().catch((err) => { console.error('Fatal error:', err); process.exit(1); });
}
