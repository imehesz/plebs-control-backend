const sqlite3 = require('sqlite3').verbose();
const readline = require('readline');
const path = require('path');

const DB_PATH = path.join(__dirname, 'plebs_control.db');
const TEST_EMAIL = 'imtest@gmail.com';

const TIER_NAMES = { 1: 'Probation (The Duumvir)', 2: 'Governance (The Governor)' };
const TIER_DURATIONS = { 1: 5, 2: 10 };

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
    `SELECT u.id, u.current_tier, u.day_in_tier,
            ps.city_name, ps.population, ps.treasury, ps.grain_stored, ps.public_anger
     FROM users u
     JOIN player_states ps ON u.id = ps.user_id
     WHERE u.email = ?`,
    [TEST_EMAIL]
  );
}

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

// ------- Display -------

function bar(value, max, width = 20) {
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function displayStats(state) {
  const tier = state.current_tier;
  const duration = TIER_DURATIONS[tier] || '?';
  const tierName = TIER_NAMES[tier] || `Tier ${tier}`;

  console.log('\n' + '═'.repeat(52));
  console.log(`  PLEBS CONTROL  |  ${tierName}`);
  console.log(`  City: ${state.city_name.padEnd(20)}  Year ${state.day_in_tier} of ${duration}`);
  console.log('─'.repeat(52));
  console.log(`  Population : ${String(state.population).padStart(7)}  ${bar(state.population, 5000)}`);
  console.log(`  Grain      : ${String(state.grain_stored).padStart(7)}`);
  console.log(`  Treasury   : ${String(state.treasury).padStart(7)}`);
  console.log(`  Anger      : ${String(state.public_anger).padStart(7)}  ${bar(state.public_anger, 100)}`);
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
  const starvationPenalty =
    population > 0 ? Math.floor((starved / population) * 100) : 100;

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
  const inputRegex = /TAX:\s*(\d+)\s+GRAIN:\s*(\d+)/i;

  console.log('\n  Welcome to PLEBS CONTROL');
  console.log("  Rule your Roman city. Don't let them starve or revolt.\n");

  while (true) {
    const state = await getState();
    displayStats(state);

    if (state.population <= 0) {
      console.log('\n  GAME OVER — Your city has perished. The last pleb has died.\n');
      break;
    }
    if (state.public_anger >= 100) {
      console.log('\n  GAME OVER — The mob has risen. You have been overthrown.\n');
      break;
    }

    const rawInput = await reader.read('\n  Enter your orders > ');
    if (rawInput === null) break; // EOF / Ctrl+C

    const match = rawInput.match(inputRegex);
    if (!match) {
      console.log('  The Scribe is confused. Use format: TAX: [number] GRAIN: [number]');
      continue;
    }

    const taxRate = parseInt(match[1], 10);
    const grainDistributed = parseInt(match[2], 10);

    const updated = processTurn(state, taxRate, grainDistributed);

    if (updated._grainCapped) {
      console.log(`\n  [Silo] Only ${state.grain_stored} grain available — distribution capped. Pay attention to your stores!`);
    }
    if (updated._starved > 0) {
      console.log(`\n  [Famine] ${updated._starved} plebs starved this year.`);
    }

    updated.day_in_tier = state.day_in_tier + 1;

    // Check lose conditions after processing
    if (updated.population <= 0) {
      await saveState(updated);
      console.log('\n  GAME OVER — Your city has perished. The last pleb has died.\n');
      break;
    }
    if (updated.public_anger >= 100) {
      await saveState(updated);
      console.log('\n  GAME OVER — The mob has risen. You have been overthrown.\n');
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
        console.log('\n  ★ PROMOTED — You have survived Probation!');
        console.log(`  You are now Governor of ${newCity}.\n`);
        continue;
      }

      if (state.current_tier === 2) {
        await saveState(updated);
        console.log('\n  ★ VICTORY — You have mastered Governance. Rome is pleased.\n');
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
