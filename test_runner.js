// Plebs Control — Balance Test Runner
// Runs 70 simulations (10 strategies × 7 levels), no DB writes, pure in-memory.
// Usage:  node test_runner.js
//         node test_runner.js > results.txt

const sqlite3 = require('sqlite3').verbose();
const path    = require('path');

const DB_PATH = path.join(__dirname, 'plebs_control.db');

const RUNS_PER_STRATEGY = 100; // how many times each strategy is simulated per level

// ── Helpers ───────────────────────────────────────────────────────────────────

function pick(arr)  { return arr[Math.floor(Math.random() * arr.length)]; }
function fmt(n)     { return Math.round(n).toLocaleString('en-US'); }
function pad(s, n)  { return String(s).padEnd(n); }
function rpad(s, n) { return String(s).padStart(n); }

const DISASTER_LABELS = ['Rats', 'Bad weather', 'Bandits', 'Flooding', 'Fire'];

// ── Game logic (mirrors game.js exactly) ─────────────────────────────────────

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
  const startPopulation = population;
  const events = [];

  if (grainDistributed > grain_stored) grainDistributed = grain_stored;

  // 1. Grain-based starvation / growth
  if (grain_stored < population * 20) {
    const plebsFed = Math.floor(grain_stored / 20);
    starved = population - plebsFed;
    population = plebsFed;
  } else if (grain_stored > population * growth_threshold) {
    population = Math.floor(population * 1.01);
  }

  // 2. Treasury
  treasury += taxRate * population;

  // 3. Harvest
  const grainConsumed = starved > 0 ? grain_stored : Math.min(grainDistributed, grain_stored);
  grain_stored = Math.max(0, grain_stored - grainConsumed + population * harvest_multiplier);

  // 4. Anger
  let taxPenalty = Math.max(0, taxRate - 10);
  if (current_tier >= 2) taxPenalty *= 1.2;
  const starvationPenalty = Math.min(40,
    population > 0 ? Math.floor((starved / population) * 100) : 100);
  public_anger = Math.max(0, Math.min(100, Math.round(
    public_anger - 5 + taxPenalty + starvationPenalty
  )));

  // 5. Anger-based population growth/shrink
  if (population > 0) {
    const rate = populationGrowthRate(public_anger);
    population = Math.max(0, Math.floor(population + population * rate));
  }

  // 6. Events (Level 4+)
  if (current_tier >= 4) {
    if (current_tier >= 6) {
      if (Math.random() < disaster_risk) {
        const grainLost = Math.floor(grain_stored * disaster_risk);
        grain_stored = Math.max(0, grain_stored - grainLost);
        events.push(`Disaster(${pick(DISASTER_LABELS)}): -${fmt(grainLost)} grain`);
      }
      if (public_anger > 50 && Math.random() < disaster_risk) {
        const popLost = Math.floor(population * disaster_risk);
        population = Math.max(0, population - popLost);
        events.push(`Sickness: -${fmt(popLost)} pop`);
      }
    } else {
      if (Math.random() < disaster_risk) {
        if (public_anger > 50) {
          const popLost = Math.floor(population * disaster_risk);
          population = Math.max(0, population - popLost);
          events.push(`Sickness: -${fmt(popLost)} pop`);
        } else {
          const grainLost = Math.floor(grain_stored * disaster_risk);
          grain_stored = Math.max(0, grain_stored - grainLost);
          events.push(`Disaster(${pick(DISASTER_LABELS)}): -${fmt(grainLost)} grain`);
        }
      }
    }
  }

  // 7. Streaks
  if (population > startPopulation) { growth_streak++; } else { growth_streak = 0; }
  if (public_anger < 20)            { happy_streak++;  } else { happy_streak  = 0; }

  if (growth_streak >= 3) {
    const bounty = population * 2;
    treasury += bounty;
    events.push(`Caesar's Favor: +${fmt(bounty)} denarii`);
    growth_streak = 0;
  }
  if (happy_streak >= 3) {
    treasury -= 50000;
    events.push(`Senatorial Scrutiny: -50,000 denarii`);
    happy_streak = 0;
  }

  return { ...state, population, treasury, grain_stored, public_anger,
           growth_streak, happy_streak, _starved: starved, _events: events };
}

// ── Strategies (10 total, covering all required behaviour types) ──────────────

const STRATEGIES = [
  {
    name: 'Conservative Tax / No Buy',
    desc: 'TAX:5  GRAIN:40% silo  BUY:0',
    decide: (s, p) => ({ tax: 5,  grain: Math.floor(s.grain_stored * 0.4), buy: 0 }),
  },
  {
    name: 'Aggressive Tax / No Buy',
    desc: 'TAX:25  GRAIN:40% silo  BUY:0',
    decide: (s, p) => ({ tax: 25, grain: Math.floor(s.grain_stored * 0.4), buy: 0 }),
  },
  {
    name: 'Max Tax / No Buy',
    desc: 'TAX:50  GRAIN:50% silo  BUY:0',
    decide: (s, p) => ({ tax: 50, grain: Math.floor(s.grain_stored * 0.5), buy: 0 }),
  },
  {
    name: 'Balanced / No Buy',
    desc: 'TAX:10  GRAIN:50% silo  BUY:0',
    decide: (s, p) => ({ tax: 10, grain: Math.floor(s.grain_stored * 0.5), buy: 0 }),
  },
  {
    name: 'Zero Grain Distribution',
    desc: 'TAX:10  GRAIN:0  BUY:0  (grain never consumed)',
    decide: (s, p) => ({ tax: 10, grain: 0,                                buy: 0 }),
  },
  {
    name: 'Survival Floor Grain',
    desc: 'TAX:10  GRAIN:pop×20 exactly  BUY:0',
    decide: (s, p) => ({ tax: 10, grain: s.population * 20,                buy: 0 }),
  },
  {
    name: 'Luxury Grain / No Buy',
    desc: 'TAX:5  GRAIN:80% silo  BUY:0  (drain silos fast)',
    decide: (s, p) => ({ tax: 5,  grain: Math.floor(s.grain_stored * 0.8), buy: 0 }),
  },
  {
    name: 'Conservative Tax / Buy Heavy',
    desc: 'TAX:5  GRAIN:30% silo  BUY:50% treasury',
    decide: (s, p) => ({
      tax:   5,
      grain: Math.floor(s.grain_stored * 0.3),
      buy:   Math.floor(s.treasury * 0.5 / p),
    }),
  },
  {
    name: 'High Tax / Buy Safety Net',
    desc: 'TAX:20  GRAIN:40% silo  BUY:20% treasury',
    decide: (s, p) => ({
      tax:   20,
      grain: Math.floor(s.grain_stored * 0.4),
      buy:   Math.floor(s.treasury * 0.2 / p),
    }),
  },
  {
    name: 'Adaptive Play',
    desc: 'TAX/GRAIN/BUY adjust to anger + grain levels each turn',
    decide: (s, p) => {
      let tax, grain, buy = 0;
      if      (s.public_anger > 50) tax = 5;
      else if (s.public_anger > 30) tax = 8;
      else if (s.public_anger < 15) tax = 15;
      else                          tax = 10;

      if (s.grain_stored < s.population * 25) {
        grain = Math.floor(s.grain_stored * 0.3);
        if (s.treasury > 0) buy = Math.floor(s.treasury * 0.3 / p);
      } else {
        grain = Math.floor(s.grain_stored * 0.5);
      }
      return { tax, grain, buy };
    },
  },
];

// ── Single simulation ─────────────────────────────────────────────────────────

function runSim(levelConfig, strategy) {
  let state = {
    population:         levelConfig.start_population,
    grain_stored:       levelConfig.start_grain,
    treasury:           levelConfig.start_treasury,
    public_anger:       levelConfig.start_anger,
    current_tier:       levelConfig.level_id,
    harvest_multiplier: levelConfig.harvest_multiplier,
    disaster_risk:      levelConfig.disaster_risk,
    growth_threshold:   levelConfig.growth_threshold,
    growth_streak:      0,
    happy_streak:       0,
  };

  const turnLog = [];

  for (let turn = 1; turn <= levelConfig.term_years; turn++) {
    const grainPrice = Math.floor(Math.random() * 4) + 1;
    const { tax, grain, buy } = strategy.decide(state, grainPrice);

    // Market buy (pre-turn)
    let actualBuy = 0;
    if (buy > 0) {
      const cost = buy * grainPrice;
      if (cost <= state.treasury) {
        state.treasury    -= cost;
        state.grain_stored += buy;
        actualBuy          = buy;
      }
    }

    const updated = processTurn(state, tax, grain);
    state = { ...updated };

    turnLog.push({
      turn,
      tax,
      grain,
      buy: actualBuy,
      pop:      state.population,
      anger:    state.public_anger,
      grainS:   state.grain_stored,
      treasury: state.treasury,
      starved:  updated._starved,
      events:   updated._events,
    });

    if (state.population   <= 0)  return { outcome: 'FAMINE', endTurn: turn, finalState: state, turnLog };
    if (state.public_anger >= 100) return { outcome: 'REVOLT', endTurn: turn, finalState: state, turnLog };
  }

  return { outcome: 'WIN', endTurn: levelConfig.term_years, finalState: state, turnLog };
}

// ── Report ────────────────────────────────────────────────────────────────────

function printReport(allResults) {
  const W = 92;
  const hr = '─'.repeat(W);
  const HR = '═'.repeat(W);

  console.log('\n' + HR);
  console.log('  PLEBS CONTROL — BALANCE TEST REPORT');
  console.log('  ' + new Date().toLocaleString());
  console.log(HR);

  const levelSummary = [];

  for (const { levelConfig: lc, results } of allResults) {
    const wins    = results.filter(r => r.outcome === 'WIN').length;
    const famines = results.filter(r => r.outcome === 'FAMINE').length;
    const revolts = results.filter(r => r.outcome === 'REVOLT').length;

    console.log(`\n  Level ${lc.level_id} — ${lc.rank_title}`);
    console.log(`  Terms: ${lc.term_years} turns | Start pop: ${fmt(lc.start_population)} | ` +
                `Harvest mult: ${lc.harvest_multiplier} | Disaster risk: ${lc.disaster_risk}`);
    console.log('  ' + hr);
    console.log(`  ${'Strategy'.padEnd(35)} Outcome   End     Final Pop    Anger  Notable`);
    console.log('  ' + hr);

    for (const r of results) {
      const allWin  = r._wins === RUNS_PER_STRATEGY;
      const anyWin  = r._wins > 0;
      const icon    = allWin ? '✅' : anyWin ? '🔶' : r.outcome === 'FAMINE' ? '☠️ ' : '⚔️ ';
      const notable = r.turnLog.flatMap(t => t.events).slice(0, 2).join(' | ') || '—';
      const wfr     = `${r._wins}W/${r._famines}F/${r._revolts}R`;
      console.log(
        `  ${icon} ${pad(r.strategyName, 33)} ${rpad(wfr, 9)} avg:${r.endTurn}/${lc.term_years}  ` +
        `${rpad(fmt(r.finalState.population), 11)} ${rpad(r.finalState.public_anger, 6)} ` +
        notable.substring(0, 28)
      );
    }

    console.log('  ' + hr);
    console.log(`  ✅ ${wins} wins  ☠️  ${famines} famines  ⚔️  ${revolts} revolts  —  ${Math.round(wins / results.length * 100)}% win rate\n`);

    levelSummary.push({ level: lc.level_id, rank: lc.rank_title, wins, famines, revolts, total: results.length });
  }

  // ── Overall summary ──
  console.log('\n' + HR);
  console.log('  OVERALL SUMMARY BY LEVEL');
  console.log(HR);
  console.log(`  ${'Lv'.padEnd(4)} ${'Rank'.padEnd(14)} ${'Wins'.padEnd(6)} ${'Famine'.padEnd(8)} ${'Revolt'.padEnd(8)} Win%`);
  console.log('  ' + '─'.repeat(50));

  let [tw, tf, tr, tt] = [0, 0, 0, 0];
  for (const s of levelSummary) {
    console.log(
      `  ${rpad(s.level, 4)} ${pad(s.rank, 14)} ${rpad(s.wins, 6)} ${rpad(s.famines, 8)} ` +
      `${rpad(s.revolts, 8)} ${Math.round(s.wins / s.total * 100)}%`
    );
    tw += s.wins; tf += s.famines; tr += s.revolts; tt += s.total;
  }
  console.log('  ' + '─'.repeat(50));
  console.log(
    `  ${'ALL'.padEnd(4)} ${''.padEnd(14)} ${rpad(tw, 6)} ${rpad(tf, 8)} ${rpad(tr, 8)} ` +
    `${Math.round(tw / tt * 100)}%`
  );

  // ── Strategy breakdown ──
  console.log('\n' + HR);
  console.log('  STRATEGY WIN RATES (across all levels)');
  console.log(HR);

  const stratMap = {};
  for (const { results } of allResults) {
    for (const r of results) {
      if (!stratMap[r.strategyName]) stratMap[r.strategyName] = { wins: 0, famine: 0, revolt: 0, total: 0 };
      stratMap[r.strategyName].total++;
      if (r.outcome === 'WIN')    stratMap[r.strategyName].wins++;
      if (r.outcome === 'FAMINE') stratMap[r.strategyName].famine++;
      if (r.outcome === 'REVOLT') stratMap[r.strategyName].revolt++;
    }
  }
  console.log(`  ${'Strategy'.padEnd(35)} W/F/R     ${'Win%'.padEnd(5)}  Bar`);
  console.log('  ' + '─'.repeat(72));
  for (const [name, s] of Object.entries(stratMap)) {
    const pct    = Math.round(s.wins / s.total * 100);
    const filled = Math.round(pct / 5);
    const bar    = '█'.repeat(filled) + '░'.repeat(20 - filled);
    console.log(
      `  ${pad(name, 35)} ${rpad(s.wins+'/'+s.famine+'/'+s.revolt, 9)} ${rpad(pct+'%', 5)}  ${bar}`
    );
  }

  console.log('\n' + HR);
  console.log('  Notes:');
  console.log('  • Each simulation uses random grain price (1-4/turn) and random event rolls.');
  console.log('  • Run multiple times to average out RNG variance.');
  console.log('  • Zero Grain Distribution never triggers starvation — watch for balance issues.');
  console.log('  • Senatorial Scrutiny (-50k) fires after 3 consecutive low-anger years.');
  console.log(HR + '\n');
}

// ── DB + entry point ──────────────────────────────────────────────────────────

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  );
}

async function main() {
  const db     = new sqlite3.Database(DB_PATH);
  const levels = await dbAll(db, `SELECT * FROM level_config ORDER BY level_id`);
  db.close();

  const totalRuns = levels.length * STRATEGIES.length * RUNS_PER_STRATEGY;
  console.log(`\nRunning ${totalRuns} simulations (${levels.length} levels × ${STRATEGIES.length} strategies × ${RUNS_PER_STRATEGY} runs)...\n`);

  const allResults = [];

  for (const lc of levels) {
    const results = [];
    for (const strategy of STRATEGIES) {
      const runs = [];
      for (let r = 0; r < RUNS_PER_STRATEGY; r++) {
        runs.push(runSim(lc, strategy));
      }
      // Aggregate: best outcome wins (WIN > REVOLT > FAMINE), avg end turn
      const wins    = runs.filter(r => r.outcome === 'WIN').length;
      const famines = runs.filter(r => r.outcome === 'FAMINE').length;
      const revolts = runs.filter(r => r.outcome === 'REVOLT').length;
      const topOutcome = wins > 0 ? 'WIN' : revolts > 0 ? 'REVOLT' : 'FAMINE';
      const avgEndTurn = Math.round(runs.reduce((s, r) => s + r.endTurn, 0) / runs.length);
      const lastRun    = runs[runs.length - 1];

      results.push({
        strategyName: strategy.name,
        outcome:      topOutcome,
        endTurn:      avgEndTurn,
        finalState:   lastRun.finalState,
        turnLog:      lastRun.turnLog,
        _wins: wins, _famines: famines, _revolts: revolts,
      });

      const icon = wins === RUNS_PER_STRATEGY ? '✅' : wins > 0 ? '🔶' : revolts > 0 ? '⚔️ ' : '☠️ ';
      console.log(
        `  L${lc.level_id} ${pad(strategy.name, 35)} → ${icon}  ${wins}W/${famines}F/${revolts}R ` +
        `(avg turn ${avgEndTurn}/${lc.term_years})`
      );
    }
    allResults.push({ levelConfig: lc, results });
    console.log();
  }

  printReport(allResults);
}

main().catch(err => { console.error(err); process.exit(1); });
