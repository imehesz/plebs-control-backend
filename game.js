const sqlite3 = require('sqlite3').verbose();
const readline = require('readline');
const path = require('path');

const DB_PATH = path.join(__dirname, 'plebs_control.db');
const TEST_EMAIL = 'imtest@gmail.com';

const ROMAN_NUMERALS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
function toRoman(n) { return ROMAN_NUMERALS[n] || String(n); }

const GREETINGS = ['Salve', 'Ave', 'Salvete', 'Bene venisti', 'Io'];
function randomGreeting() { return GREETINGS[Math.floor(Math.random() * GREETINGS.length)]; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
function arrow(curr, prev) {
  if (prev == null) return '  ';
  if (curr > prev) return ' ↑';
  if (curr < prev) return ' ↓';
  return '  ';
}

const DISASTER_EVENTS = [
  { label: 'Rats',        verb: 'infested' },
  { label: 'Bad weather', verb: 'affected' },
  { label: 'Bandits',     verb: 'raided' },
  { label: 'Flooding',    verb: 'damaged' },
  { label: 'Fire',        verb: 'ravaged' },
];

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

// ------- Migrations -------

async function migrate() {
  for (const sql of [
    `ALTER TABLE player_states ADD COLUMN growth_streak INTEGER DEFAULT 0`,
    `ALTER TABLE player_states ADD COLUMN happy_streak INTEGER DEFAULT 0`,
  ]) {
    try { await dbRun(sql); } catch (_) { /* column already exists */ }
  }
}

// ------- Game data -------

async function getState() {
  return dbGet(
    `SELECT u.id, u.current_tier, u.day_in_tier, u.player_name,
            ps.city_name, ps.population, ps.treasury, ps.grain_stored, ps.public_anger,
            ps.growth_streak, ps.happy_streak,
            lc.rank_title, lc.term_years, lc.harvest_multiplier, lc.disaster_risk, lc.growth_threshold
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

function bar(value, max, width = 20) {
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function displayStats(state, grainPrice, prev) {
  const p = prev || {};
  console.log('\n' + '═'.repeat(58));
  console.log(`  🏛️  PLEBS CONTROL  |  ${state.rank_title}`);
  console.log(`  City: ${state.city_name.padEnd(20)}  Year ${toRoman(state.day_in_tier)} of ${toRoman(state.term_years)}`);
  console.log('─'.repeat(58));
  console.log(`  👥 Population : ${fmt(state.population).padStart(12)}${arrow(state.population, p.population)}`);
  console.log(`  🌾 Grain      : ${fmt(state.grain_stored).padStart(12)}${arrow(state.grain_stored, p.grain_stored)}`);
  console.log(`  🪙 Treasury   : ${fmt(state.treasury).padStart(12)}${arrow(state.treasury, p.treasury)}`);
  console.log(`  📈 Mkt Price  : ${fmt(grainPrice).padStart(12)}  denarii/grain`);
  console.log(`  😠 Anger      : ${fmt(state.public_anger).padStart(12)}${arrow(state.public_anger, p.public_anger)}  ${bar(state.public_anger, 100)}`);
  console.log('═'.repeat(58));
}

// ------- Simulation -------

function populationGrowthRate(anger) {
  if (anger <= 5)  return  0.10;
  if (anger <= 10) return  0.05;
  if (anger <= 20) return  0.01;
  if (anger <= 30) return -0.05;
  if (anger <= 40) return -0.10;
  return -0.25;
}

function processTurn(state, taxRate, grainDistributed) {
  let { population, treasury, grain_stored, public_anger, current_tier,
        harvest_multiplier, disaster_risk, growth_threshold } = state;

  let growth_streak = state.growth_streak || 0;
  let happy_streak  = state.happy_streak  || 0;

  let starved = 0;
  let grainCapped = false;
  const startPopulation = population;
  const events = [];

  // Cap distribution at what's in the silo
  if (grainDistributed > grain_stored) {
    grainDistributed = grain_stored;
    grainCapped = true;
  }

  // 1. Grain-based Starvation / Growth (uses grain_stored as Total_Grain_Available)
  if (grain_stored < population * 20) {
    const plebsFed = Math.floor(grain_stored / 20);
    starved = population - plebsFed;
    population = plebsFed;
  } else if (grain_stored > population * growth_threshold) {
    population = Math.floor(population * 1.01);
  }

  // 2. Treasury Phase
  treasury = treasury + taxRate * population;

  // 3. Harvest Phase — all grain consumed when starving, otherwise player's input
  const grainConsumed = starved > 0 ? grain_stored : Math.min(grainDistributed, grain_stored);
  grain_stored = Math.max(0, grain_stored - grainConsumed + population * harvest_multiplier);

  // 4. Public Anger Phase
  const baseAnger = -5;
  let taxPenalty = Math.max(0, taxRate - 10);
  if (current_tier >= 2) taxPenalty *= 1.2;
  const starvationPenalty = Math.min(40,
    population > 0 ? Math.floor((starved / population) * 100) : 100);

  public_anger = public_anger + baseAnger + taxPenalty + starvationPenalty;
  public_anger = Math.max(0, Math.min(100, Math.round(public_anger)));

  // 5. Anger-based Population Growth/Shrink (runs alongside grain-based system)
  if (population > 0) {
    const rate = populationGrowthRate(public_anger);
    population = Math.max(0, Math.floor(population + population * rate));
  }

  // 6. Event System (Level 4+)
  if (current_tier >= 4) {
    if (current_tier >= 6) {
      // Level 6-7: two independent rolls — can be both, either, or nothing
      if (Math.random() < disaster_risk) {
        const grainLost = Math.floor(grain_stored * disaster_risk);
        grain_stored = Math.max(0, grain_stored - grainLost);
        const d = pick(DISASTER_EVENTS);
        events.push({ type: 'disaster', label: d.label, verb: d.verb, grainLost });
      }
      if (public_anger > 50 && Math.random() < disaster_risk) {
        const popLost = Math.floor(population * disaster_risk);
        population = Math.max(0, population - popLost);
        events.push({ type: 'sickness', popLost, city: state.city_name });
      }
    } else {
      // Level 4-5: single roll — sickness (if anger >50) OR disaster OR nothing
      if (Math.random() < disaster_risk) {
        if (public_anger > 50) {
          const popLost = Math.floor(population * disaster_risk);
          population = Math.max(0, population - popLost);
          events.push({ type: 'sickness', popLost, city: state.city_name });
        } else {
          const grainLost = Math.floor(grain_stored * disaster_risk);
          grain_stored = Math.max(0, grain_stored - grainLost);
          const d = pick(DISASTER_EVENTS);
          events.push({ type: 'disaster', label: d.label, verb: d.verb, grainLost });
        }
      }
    }
  }

  // 7. Streak Updates & Triggered Events

  // Growth streak — compare final population to start-of-turn population
  if (population > startPopulation) {
    growth_streak++;
  } else {
    growth_streak = 0;
  }

  // Happy streak — anger < 20 at end of turn
  if (public_anger < 20) {
    happy_streak++;
  } else {
    happy_streak = 0;
  }

  if (growth_streak >= 3) {
    const bounty = population * 2;
    treasury += bounty;
    events.push({ type: 'caesars_favor', amount: bounty });
    growth_streak = 0;
  }

  if (happy_streak >= 3) {
    treasury -= 50000;
    events.push({ type: 'senatorial_scrutiny' });
    happy_streak = 0;
  }

  return { ...state, population, treasury, grain_stored, public_anger, growth_streak, happy_streak,
           _starved: starved, _grainCapped: grainCapped, _events: events };
}

// ------- Main loop -------

async function main() {
  await migrate();
  const reader = new LineReader();
  const inputRegex = /TAX:\s*(\d+)\s+GRAIN:\s*(\d+)(?:\s+BUY:\s*(\d+))?/i;

  const intro = await getState();
  console.log(`\n  🏛️  Salve, ${address(intro)}! Welcome to PLEBS CONTROL`);
  console.log("  Rule your Roman city. Don't let them starve or revolt.\n");

  let prevState = null;
  while (true) {
    const state = await getState();
    const grainPrice = Math.floor(Math.random() * 4) + 1;
    displayStats(state, grainPrice, prevState);
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

    const rawInput = await reader.read(`\n  ${randomGreeting()}, ${address(state)} — enter your orders > `);
    if (rawInput === null) break;

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
        console.log(`\n  💸 Not enough denarii! ${buyAmount} grain costs ${cost} denarii — your treasury holds only ${fmt(state.treasury)}.`);
        continue;
      }
      state.treasury -= cost;
      state.grain_stored += buyAmount;
      console.log(`\n  🛒 Purchased ${fmt(buyAmount)} grain for ${fmt(cost)} denarii (${grainPrice} denarii/grain).`);
    }

    const updated = processTurn(state, taxRate, grainDistributed);

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

    // Check level completion
    if (state.day_in_tier >= state.term_years) {
      const nextConfig = await getLevelConfig(state.current_tier + 1);

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
        console.log(`\n  🏆 Ave, Caesar! ${address(updated)}, you have conquered all of Rome!`);
        console.log(`  Roma aeterna bows before you. Your name shall echo through the ages.\n`);
        break;
      }

      continue;
    }

    await saveState(updated);
  }

  db.close();
}

// ------- Reset -------

async function resetGame(level) {
  await migrate();
  const config = await getLevelConfig(level);
  if (!config) {
    console.error(`No level_config found for level ${level}. Check your database.`);
    db.close();
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
  db.close();
}

// ------- Entry point -------

const resetIdx = process.argv.indexOf('--resetGame');
if (resetIdx !== -1) {
  const levelArg = process.argv[resetIdx + 1];
  const level = levelArg && /^\d+$/.test(levelArg) ? parseInt(levelArg, 10) : 1;
  resetGame(level).catch((err) => { console.error('Reset failed:', err); process.exit(1); });
} else {
  main().catch((err) => { console.error('Fatal error:', err); process.exit(1); });
}
