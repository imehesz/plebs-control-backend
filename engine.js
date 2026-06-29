function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const DISASTER_EVENTS = [
  { label: 'Rats',        verb: 'infested' },
  { label: 'Bad weather', verb: 'affected' },
  { label: 'Gallic Horde', verb: 'raided' },
  { label: 'Flooding',    verb: 'damaged' },
  { label: 'Fire',        verb: 'ravaged' },
];

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

  const actualDistributed = Math.min(grainDistributed, grain_stored);

  // 1. Grain-based Starvation / Growth
  if (actualDistributed < population * 20) {
    const plebsFed = Math.floor(actualDistributed / 20);
    starved = population - plebsFed;
    population = plebsFed;
  } else if (grain_stored > population * growth_threshold) {
    population = Math.floor(population * 1.01);
  }

  // Active Tax Base: only fires when no starvation and pop 10%+ above level start
  if (state.start_population && starved === 0 && population > state.start_population * 1.10) {
    const angerBefore = public_anger;
    public_anger = Math.max(0, public_anger - 5);
    events.push({ type: 'boom_town', angerReduced: angerBefore - public_anger });
  }

  // 2. Treasury
  treasury = treasury + taxRate * population;

  // 3. Harvest
  grain_stored = Math.max(0, grain_stored - actualDistributed + population * harvest_multiplier);

  // 4. Public Anger
  const baseAnger = -5;
  let taxPenalty = Math.max(0, taxRate - 10);
  if (current_tier >= 2) taxPenalty *= 1.2;
  const starvationPenalty = Math.min(40,
    population > 0 ? Math.floor((starved / population) * 100) : 100);

  public_anger = public_anger + baseAnger + taxPenalty + starvationPenalty;
  public_anger = Math.max(0, Math.min(100, Math.round(public_anger)));

  // 5. Anger-based Population Growth/Shrink
  if (population > 0) {
    const rate = populationGrowthRate(public_anger);
    population = Math.max(0, Math.floor(population + population * rate));
  }

  // 6. Event System (Level 4+)
  if (current_tier >= 4) {
    if (current_tier >= 6) {
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

  // 7. Streaks
  if (population > startPopulation) { growth_streak++; } else { growth_streak = 0; }
  if (public_anger < 20) { happy_streak++; } else { happy_streak = 0; }

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

  const exiled = population > 0 && population < startPopulation * 0.15;

  return { ...state, population, treasury, grain_stored, public_anger, growth_streak, happy_streak,
           _starved: starved, _grainCapped: actualDistributed < grainDistributed,
           _exiled: exiled, _events: events };
}

module.exports = { processTurn, DISASTER_EVENTS, populationGrowthRate };
