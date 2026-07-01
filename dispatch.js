const { processTurn } = require('./engine');
const { sendYearOneDispatch, sendDispatch, sendAssignment } = require('./mailer');
const { dbGet, dbAll, dbRun, close } = require('./db');
const { rollGrainPrice, rollSellPrice } = require('./helpers');

async function getFullState(userId) {
  return dbGet(
    `SELECT u.id, u.email, u.current_tier, u.day_in_tier, u.player_name,
            u.pending_tax, u.pending_grain, u.pending_buy, u.pending_sell,
            ps.city_name, ps.population, ps.treasury, ps.grain_stored, ps.public_anger,
            ps.growth_streak, ps.happy_streak, ps.next_grain_price, ps.next_grain_sell_price,
            lc.rank_title, lc.term_years, lc.start_population, lc.harvest_multiplier,
            lc.disaster_risk, lc.growth_threshold
     FROM users u
     JOIN player_states ps ON u.id = ps.user_id
     JOIN level_config lc ON u.current_tier = lc.level_id
     WHERE u.id = ?`,
    [userId]
  );
}

async function issueNewAssignment(userId, tier, carryTreasury, reason) {
  const lc   = await dbGet('SELECT rank_title FROM level_config WHERE level_id = ?', [tier]);
  const user = await dbGet('SELECT email, player_name FROM users WHERE id = ?', [userId]);
  await dbRun(
    `UPDATE users SET pending_tier = ?, pending_treasury = ?,
     pending_tax = NULL, pending_grain = NULL, pending_buy = 0, pending_sell = 0 WHERE id = ?`,
    [tier, carryTreasury ?? null, userId]
  );
  await sendAssignment(user.email, user.player_name, lc.rank_title, reason);
}

async function saveState(state) {
  await dbRun(
    `UPDATE users SET current_tier = ?, day_in_tier = ?,
                      pending_tax = NULL, pending_grain = NULL, pending_buy = 0, pending_sell = 0
     WHERE id = ?`,
    [state.current_tier, state.day_in_tier, state.id]
  );
  await dbRun(
    `UPDATE player_states
     SET city_name = ?, population = ?, treasury = ?, grain_stored = ?,
         public_anger = ?, growth_streak = ?, happy_streak = ?, next_grain_price = ?,
         next_grain_sell_price = ?
     WHERE user_id = ?`,
    [state.city_name, state.population, state.treasury, state.grain_stored,
     state.public_anger, state.growth_streak || 0, state.happy_streak || 0,
     state.next_grain_price, state.next_grain_sell_price, state.id]
  );
}

async function saveTurnHistory(h) {
  await dbRun(
    `INSERT INTO turn_history
       (user_id, city_name, tier, year_in_tier,
        tax_rate, grain_ordered, grain_actual, grain_bought, grain_sold,
        pop_start, pop_end, starved,
        treasury_start, treasury_end,
        grain_start, grain_end,
        anger_start, anger_end, events)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [h.userId, h.cityName, h.tier, h.yearInTier,
     h.taxRate, h.grainOrdered, h.grainActual, h.grainBought, h.grainSold,
     h.popStart, h.popEnd, h.starved,
     h.treasuryStart, h.treasuryEnd,
     h.grainStart, h.grainEnd,
     h.angerStart, h.angerEnd,
     JSON.stringify(h.events)]
  );
}

async function runDispatch() {
  const currentHour = new Date().getUTCHours();
  const players = await dbAll(
    `SELECT id FROM users WHERE verified = 1 AND pending_tier IS NULL
     AND delivery_hour_utc = ?
     AND (
       (pending_tax IS NOT NULL AND pending_grain IS NOT NULL)
       OR day_in_tier = 1
     )`,
    [currentHour]
  );

  if (players.length === 0) {
    console.log('[dispatch] No players with pending orders.');
    close(); return;
  }

  console.log(`[dispatch] Processing ${players.length} player(s)...`);

  for (const { id } of players) {
    try {
      const state = await getFullState(id);

      // Year I with no orders yet — send initial city dispatch and wait
      if (state.day_in_tier === 1 && state.pending_tax === null) {
        const firstPrice = rollGrainPrice();
        const firstSellPrice = rollSellPrice(firstPrice);
        await dbRun(
          `UPDATE player_states SET next_grain_price = ?, next_grain_sell_price = ? WHERE user_id = ?`,
          [firstPrice, firstSellPrice, state.id]
        );
        await sendYearOneDispatch(state.email, state, firstPrice, firstSellPrice);
        console.log(`[dispatch] ${state.email} — Year I initial dispatch sent (buy=${firstPrice}, sell=${firstSellPrice})`);
        continue;
      }

      // Use the prices that were shown to the player in the last email
      const grainPrice = state.next_grain_price || rollGrainPrice();
      const sellPrice  = state.next_grain_sell_price || rollSellPrice(grainPrice);

      const orders = {
        taxRate:     state.pending_tax,
        grainAmount: state.pending_grain,
        buyAmount:   state.pending_buy || 0,
        sellAmount:  state.pending_sell || 0,
      };

      // Apply market buy before processing
      if (orders.buyAmount > 0) {
        const cost = orders.buyAmount * grainPrice;
        if (cost <= state.treasury) {
          state.treasury   -= cost;
          state.grain_stored += orders.buyAmount;
        } else {
          console.log(`[dispatch] ${state.email} can't afford BUY:${orders.buyAmount} — skipping buy`);
          orders.buyAmount = 0;
        }
      }

      // Apply market sell — reserve this year's distribution first, only the
      // surplus grain beyond that is sellable.
      if (orders.sellAmount > 0) {
        const requestedSell = orders.sellAmount;
        const sellable = Math.max(0, state.grain_stored - orders.grainAmount);
        const actualSell = Math.min(requestedSell, sellable);
        if (actualSell > 0) {
          state.treasury += actualSell * sellPrice;
          state.grain_stored -= actualSell;
        }
        orders.sellCapped = actualSell < requestedSell;
        orders.sellAmount = actualSell;
        if (orders.sellCapped) {
          console.log(`[dispatch] ${state.email} requested SELL:${requestedSell} but only ${actualSell} grain was sellable after reserving distribution`);
        }
      }

      const snapPop      = state.population;
      const snapTreasury = state.treasury;
      const snapGrain    = state.grain_stored;
      const snapAnger    = state.public_anger;

      const updated = processTurn(state, orders.taxRate, orders.grainAmount);
      updated.day_in_tier = state.day_in_tier + 1;

      const isGameOver    = updated._exiled || updated.population <= 0 || updated.public_anger >= 100;
      const isTermComplete = !isGameOver && updated.day_in_tier > state.term_years;
      const isLastLevel   = state.current_tier >= 7;

      // Roman Triumph: treasury ×1.5 when term ends with pop at or above starting level
      if (isTermComplete && updated.population >= state.start_population) {
        updated.treasury = Math.floor(updated.treasury * 1.5);
        updated._events.push({ type: 'roman_triumph' });
      }

      if (isTermComplete && isLastLevel) updated._gameWon = true;

      await saveTurnHistory({
        userId: state.id, cityName: state.city_name,
        tier: state.current_tier, yearInTier: state.day_in_tier,
        taxRate: orders.taxRate, grainOrdered: orders.grainAmount,
        grainActual: Math.min(orders.grainAmount, state.grain_stored),
        grainBought: orders.buyAmount, grainSold: orders.sellAmount,
        popStart: snapPop, popEnd: updated.population, starved: updated._starved,
        treasuryStart: snapTreasury, treasuryEnd: updated.treasury,
        grainStart: snapGrain, grainEnd: updated.grain_stored,
        angerStart: snapAnger, angerEnd: updated.public_anger,
        events: updated._events,
      });

      // Roll next turn's prices now so they can be shown in the email
      const nextGrainPrice = rollGrainPrice();
      const nextSellPrice = rollSellPrice(nextGrainPrice);
      updated.next_grain_price = nextGrainPrice;
      updated.next_grain_sell_price = nextSellPrice;

      await sendDispatch(state.email, state, updated, orders, grainPrice, nextGrainPrice, sellPrice, nextSellPrice);

      if (isGameOver) {
        await issueNewAssignment(state.id, 1, null, 'game_over');
      } else if (isTermComplete && isLastLevel) {
        await issueNewAssignment(state.id, 1, null, 'game_won');
      } else if (isTermComplete) {
        await issueNewAssignment(state.id, state.current_tier + 1, updated.treasury, 'promoted');
      } else {
        await saveState(updated);
      }

      const outcome = updated._gameWon ? 'WIN-GAME' :
                      isTermComplete    ? `PROMOTED→L${state.current_tier + 1}` :
                      updated._exiled   ? 'EXILE' :
                      updated.population <= 0 ? 'FAMINE' :
                      updated.public_anger >= 100 ? 'REVOLT' : 'OK';
      console.log(`[dispatch] ${state.email} — Year ${state.day_in_tier} → ${outcome}`);
    } catch (err) {
      console.error(`[dispatch] Error processing player ${id}:`, err);
    }
  }

  close();
  console.log('[dispatch] Done.');
}

runDispatch().catch(console.error);
