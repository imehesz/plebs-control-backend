const ROMAN_NUMERALS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
function toRoman(n) { return ROMAN_NUMERALS[n] || String(n); }

const GREETINGS = ['Salve', 'Ave', 'Salvete', 'Bene venisti', 'Io'];
function randomGreeting() { return GREETINGS[Math.floor(Math.random() * GREETINGS.length)]; }

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function fmt(n)    { return Math.round(n).toLocaleString('en-US'); }

function rollGrainPrice() {
  return Math.floor(Math.random() * 4) + 1;
}

// Sell price is always cheaper than the buy price rolled the same turn —
// 10%-25% off, floored so it never rounds back up to the buy price.
function rollSellPrice(buyPrice) {
  const discount = 0.10 + Math.random() * 0.15;
  return Math.max(1, Math.floor(buyPrice * (1 - discount)));
}

function arrow(curr, prev) {
  if (prev == null) return '  ';
  if (curr > prev) return ' ↑';
  if (curr < prev) return ' ↓';
  return '  ';
}

function bar(value, max, width = 20) {
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

const CITY_MAPS = [
  [ // L1 Duumvir — 6 lines
    '  .==========.',
    '  | [] [] [] |',
    '  |  [FORUM] |',
    '  | [] [] [] |',
    "  '=========='",
    '   ~ Via Roma ~',
  ],
  [ // L2 Aedile — 7 lines
    '  ##=========##',
    '  #|[] [T] []|#',
    '  #| [FORUM] |#',
    '  #|[] [T] []|#',
    '  ##=========##',
    '    [--GATE--]',
    '  ~ Via Augusta ~',
  ],
  [ // L3 Praetor — 8 lines
    '  ##===========##',
    '  #|[T] [] [T] |#',
    '  #|  [FORUM]  |#',
    '  #|  [BATHS]  |#',
    '  #|[T] [] [T] |#',
    '  ##===========##',
    '    [===GATE===]',
    '  ~ Via Trajana ~',
  ],
  [ // L4 Propraetor — 9 lines
    '  ###=============###',
    '  #|[T][T]   [T][T]|#',
    '  #|  [CIRCUS]     |#',
    '  #|  [FORUM]      |#',
    '  #|  [BATHS]      |#',
    '  #|[T][T]   [T][T]|#',
    '  ###=============###',
    '    [GATE]  [GATE]',
    '  ~ Via Africanus ~',
  ],
  [ // L5 Consul — 10 lines
    '  ####===============####',
    '  #||[T][T] [] [T][T]||#',
    '   || [C. MAXIMUS]   ||',
    '   ||  [COLOSSEUM]   ||',
    '   ||   [PANTHEON]   ||',
    '   ||  [FORUM MAG.]  ||',
    '  #||[T][T] [] [T][T]||#',
    '  ####===============####',
    '  [GATE]  [GATE]  [GATE]',
    '  ~ Via Orientalis ~',
  ],
  [ // L6 Praefectus — 12 lines
    '  #####===================#####',
    '  #|||[T][T]   []   [T][T]|||#',
    '   |||   [LIGHTHOUSE]      |||',
    '   |||   [GREAT LIBRARY]   |||',
    '   |||   [COLOSSEUM]       |||',
    '   |||   [FORUM MAGNUS]    |||',
    '   |||   [PALACE]          |||',
    '   |||   [HARBOUR]  ~~~~~  |||',
    '  #|||[T][T]   []   [T][T]|||#',
    '  #####===================#####',
    '  [GATE] [GATE] [GATE] [GATE]',
    '  ~ Via Alexandrinus ~',
  ],
  [ // L7 Proconsul — 13 lines
    '  *** CAPUT MUNDI — ROMA AETERNA ***',
    '  #######=========================#######',
    '  #||||[T][T][T] [] [T][T][T]||||#',
    '   ||||  [CIRCUS MAXIMUS]      ||||',
    '   ||||    [COLOSSEUM]         ||||',
    '   ||||     [PANTHEON]         ||||',
    '   ||||  [FORUM ROMANUM]       ||||',
    '   ||||  [PALATINE HILL]       ||||',
    '   ||||  [TIBER]  ~~~ ~~~      ||||',
    '  #||||[T][T][T] [] [T][T][T]||||#',
    '  #######=========================#######',
    '  [GATE][GATE] [GATE] [GATE][GATE]',
    '  ~ ROMA AETERNA ~',
  ],
];

const CAESAR_ART = `
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⣴⣶⣿⣿⢿⡶⠆⠀⠀⠀⢀⡀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⣠⣾⣿⣿⡿⠻⠋⣠⠀⢀⣶⠇⢠⣾⡿⠁⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⢀⣼⠟⠋⠻⢁⣴⠀⣾⣿⠀⠾⠟⠀⠈⣉⣠⣦⡤⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠸⠃⣠⡆⠀⣿⡟⠀⠛⠃⠀⠀⣶⣶⣦⣄⠉⢁⡄⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⣰⡀⢰⣿⠇⠀⢉⣀⣀⠛⠿⠿⠦⠀⢀⣠⣤⣴⣾⡇⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⣿⠃⠀⠠⣴⣦⡈⠙⠛⠓⠀⢰⣶⣶⣿⣿⣿⣿⣿⣧⡀⠀⠀⠀⠀
⠀⠀⢀⣤⠦⡀⠰⢷⣦⠈⠉⠉⠀⣰⣶⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⡀⠀⠀⠀
⠀⠀⠈⠁⠀⠘⣶⣤⣄⣀⣨⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠿⠃⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠘⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠈⢿⣿⣿⣯⡈⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⢨⣿⣿⣿⣷⣤⣈⡉⠛⠛⠛⠛⠻⠟⠛⠛⠛⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⣠⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠙⠻⠿⣿⣿⣿⣿⣿⣿⣿⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠉⠉⠉⠉⠀⠀⠀
      .-------------------.
     /    C A E S A R      \\
     |  I M P E R A T O R   ||
     \\____________________//
            |  ||
      ~ AVE, IMPERATOR! ~`;

module.exports = { toRoman, randomGreeting, pick, fmt, arrow, bar, CITY_MAPS, CAESAR_ART, rollGrainPrice, rollSellPrice };
