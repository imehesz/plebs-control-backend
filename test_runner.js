// Plebs Control — Balance Test Runner
// Runs 70 simulations (10 strategies × 7 levels), no DB writes, pure in-memory.
// Usage:  node test_runner.js
//         node test_runner.js > results.txt

const { processTurn } = require('./engine');
const { dbAll, close } = require('./db');

const RUNS_PER_STRATEGY = 100; // how many times each strategy is simulated per level

// ── Helpers ───────────────────────────────────────────────────────────────────

function pick(arr)  { return arr[Math.floor(Math.random() * arr.length)]; }
function fmt(n)     { return Math.round(n).toLocaleString('en-US'); }
function pad(s, n)  { return String(s).padEnd(n); }
function rpad(s, n) { return String(s).padStart(n); }

function eventToString(ev) {
  if (typeof ev === 'string') return ev;
  if (ev.type === 'boom_town')           return ev.angerReduced > 0 ? `Boom Town: -${ev.angerReduced} anger` : '';
  if (ev.type === 'disaster')            return `${ev.label}: -${fmt(ev.grainLost)} grain`;
  if (ev.type === 'sickness')            return `Sickness: -${fmt(ev.popLost)} pop`;
  if (ev.type === 'caesars_favor')       return `Caesar's Favor: +${fmt(ev.amount)} denarii`;
  if (ev.type === 'senatorial_scrutiny') return `Senatorial Scrutiny: -50,000 denarii`;
  if (ev.type === 'roman_triumph')       return `Roman Triumph: treasury ×1.5`;
  return JSON.stringify(ev);
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
    start_population:   levelConfig.start_population,
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

    if (state.population   <= 0)   return { outcome: 'FAMINE', endTurn: turn, finalState: state, turnLog };
    if (state.public_anger >= 100) return { outcome: 'REVOLT', endTurn: turn, finalState: state, turnLog };
    if (updated._exiled)           return { outcome: 'EXILE',  endTurn: turn, finalState: state, turnLog };
  }

  // Thriving Metropolis: survived the term with population at or above the starting level
  if (state.population >= levelConfig.start_population) {
    state = { ...state, treasury: Math.floor(state.treasury * 1.5) };
    turnLog[turnLog.length - 1].events.push({ type: 'roman_triumph' });
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
    const exiles  = results.filter(r => r.outcome === 'EXILE').length;

    console.log(`\n  Level ${lc.level_id} — ${lc.rank_title}`);
    console.log(`  Terms: ${lc.term_years} turns | Start pop: ${fmt(lc.start_population)} | ` +
                `Harvest mult: ${lc.harvest_multiplier} | Disaster risk: ${lc.disaster_risk}`);
    console.log('  ' + hr);
    console.log(`  ${'Strategy'.padEnd(35)} Outcome   End     Final Pop    Anger  Notable`);
    console.log('  ' + hr);

    for (const r of results) {
      const allWin  = r._wins === RUNS_PER_STRATEGY;
      const anyWin  = r._wins > 0;
      const icon    = allWin ? '✅' : anyWin ? '🔶' : r.outcome === 'FAMINE' ? '☠️ ' : r.outcome === 'EXILE' ? '🏚️' : '⚔️ ';
      const notable = r.turnLog.flatMap(t => t.events).map(eventToString).filter(Boolean).slice(0, 2).join(' | ') || '—';
      const wfr     = `${r._wins}W/${r._famines}F/${r._revolts}R`;
      console.log(
        `  ${icon} ${pad(r.strategyName, 33)} ${rpad(wfr, 9)} avg:${r.endTurn}/${lc.term_years}  ` +
        `${rpad(fmt(r.finalState.population), 11)} ${rpad(r.finalState.public_anger, 6)} ` +
        notable.substring(0, 28)
      );
    }

    console.log('  ' + hr);
    console.log(`  ✅ ${wins} wins  ☠️  ${famines} famines  ⚔️  ${revolts} revolts  🏚️  ${exiles} exiles  —  ${Math.round(wins / results.length * 100)}% win rate\n`);

    levelSummary.push({ level: lc.level_id, rank: lc.rank_title, wins, famines, revolts, exiles, total: results.length });
  }

  // ── Overall summary ──
  console.log('\n' + HR);
  console.log('  OVERALL SUMMARY BY LEVEL');
  console.log(HR);
  console.log(`  ${'Lv'.padEnd(4)} ${'Rank'.padEnd(14)} ${'Wins'.padEnd(6)} ${'Famine'.padEnd(8)} ${'Revolt'.padEnd(8)} ${'Exile'.padEnd(7)} Win%`);
  console.log('  ' + '─'.repeat(58));

  let [tw, tf, tr, te, tt] = [0, 0, 0, 0, 0];
  for (const s of levelSummary) {
    console.log(
      `  ${rpad(s.level, 4)} ${pad(s.rank, 14)} ${rpad(s.wins, 6)} ${rpad(s.famines, 8)} ` +
      `${rpad(s.revolts, 8)} ${rpad(s.exiles, 7)} ${Math.round(s.wins / s.total * 100)}%`
    );
    tw += s.wins; tf += s.famines; tr += s.revolts; te += s.exiles; tt += s.total;
  }
  console.log('  ' + '─'.repeat(58));
  console.log(
    `  ${'ALL'.padEnd(4)} ${''.padEnd(14)} ${rpad(tw, 6)} ${rpad(tf, 8)} ${rpad(tr, 8)} ` +
    `${rpad(te, 7)} ${Math.round(tw / tt * 100)}%`
  );

  // ── Strategy breakdown ──
  console.log('\n' + HR);
  console.log('  STRATEGY WIN RATES (across all levels)');
  console.log(HR);

  const stratMap = {};
  for (const { results } of allResults) {
    for (const r of results) {
      if (!stratMap[r.strategyName]) stratMap[r.strategyName] = { wins: 0, famine: 0, revolt: 0, exile: 0, total: 0 };
      stratMap[r.strategyName].total++;
      if (r.outcome === 'WIN')    stratMap[r.strategyName].wins++;
      if (r.outcome === 'FAMINE') stratMap[r.strategyName].famine++;
      if (r.outcome === 'REVOLT') stratMap[r.strategyName].revolt++;
      if (r.outcome === 'EXILE')  stratMap[r.strategyName].exile++;
    }
  }
  console.log(`  ${'Strategy'.padEnd(35)} W/F/R/E     ${'Win%'.padEnd(5)}  Bar`);
  console.log('  ' + '─'.repeat(74));
  for (const [name, s] of Object.entries(stratMap)) {
    const pct    = Math.round(s.wins / s.total * 100);
    const filled = Math.round(pct / 5);
    const bar    = '█'.repeat(filled) + '░'.repeat(20 - filled);
    console.log(
      `  ${pad(name, 35)} ${rpad(s.wins+'/'+s.famine+'/'+s.revolt+'/'+s.exile, 11)} ${rpad(pct+'%', 5)}  ${bar}`
    );
  }

  console.log('\n' + HR);
  console.log('  Notes:');
  console.log('  • Each simulation uses random grain price (1-4/turn) and random event rolls.');
  console.log('  • Run multiple times to average out RNG variance.');
  console.log('  • Zero Grain Distribution triggers instant famine (turn 1) — starvation is tied to actualDistributed.');
  console.log('  • Senatorial Scrutiny (-50k) fires after 3 consecutive low-anger years.');
  console.log(HR + '\n');
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const levels = await dbAll(`SELECT * FROM level_config ORDER BY level_id`);
  close();

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
      const exiles  = runs.filter(r => r.outcome === 'EXILE').length;
      const topOutcome = wins > 0 ? 'WIN' : revolts > 0 ? 'REVOLT' : exiles > 0 ? 'EXILE' : 'FAMINE';
      const avgEndTurn = Math.round(runs.reduce((s, r) => s + r.endTurn, 0) / runs.length);
      const lastRun    = runs[runs.length - 1];

      results.push({
        strategyName: strategy.name,
        outcome:      topOutcome,
        endTurn:      avgEndTurn,
        finalState:   lastRun.finalState,
        turnLog:      lastRun.turnLog,
        _wins: wins, _famines: famines, _revolts: revolts, _exiles: exiles,
      });

      const icon = wins === RUNS_PER_STRATEGY ? '✅' : wins > 0 ? '🔶' : revolts > 0 ? '⚔️ ' : exiles > 0 ? '🏚️' : '☠️ ';
      console.log(
        `  L${lc.level_id} ${pad(strategy.name, 35)} → ${icon}  ${wins}W/${famines}F/${revolts}R/${exiles}E ` +
        `(avg turn ${avgEndTurn}/${lc.term_years})`
      );
    }
    allResults.push({ levelConfig: lc, results });
    console.log();
  }

  printReport(allResults);
}

main().catch(err => { console.error(err); process.exit(1); });
