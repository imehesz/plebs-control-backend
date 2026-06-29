-- 1. Create Tables
CREATE TABLE IF NOT EXISTS level_config (
    level_id INTEGER PRIMARY KEY,
    rank_title VARCHAR NOT NULL,
    term_years INTEGER NOT NULL,
    start_population INTEGER NOT NULL,
    start_grain INTEGER NOT NULL,
    start_treasury INTEGER NOT NULL,
    start_anger INTEGER NOT NULL,
    harvest_multiplier INTEGER NOT NULL DEFAULT 4
);

INSERT OR IGNORE INTO level_config (level_id, rank_title, term_years, start_population, start_grain, start_treasury, start_anger, harvest_multiplier) VALUES
(1, 'Duumvir', 5,  1000,    75000,       0, 10, 10),
(2, 'Aedile',  10, 10000,  600000,   5000, 10, 12),
(3, 'Praetor', 15, 50000, 2500000,  25000, 10,  8); -- disaster_risk 0.02 set directly in DB


CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    player_name TEXT NOT NULL,
    delivery_hour_utc INTEGER NOT NULL DEFAULT 12,
    awaiting_reply BOOLEAN DEFAULT FALSE,
    verified BOOLEAN DEFAULT TRUE,
    current_tier INTEGER DEFAULT 1,
    day_in_tier INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS turn_history (
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
);

CREATE TABLE IF NOT EXISTS player_states (
    user_id INTEGER PRIMARY KEY,
    city_name TEXT NOT NULL,
    population INTEGER DEFAULT 1000,
    treasury INTEGER DEFAULT 0,
    grain_stored INTEGER DEFAULT 50000,
    public_anger INTEGER DEFAULT 20,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2. City Name Database (20 per level, 7 levels = 140 total)
CREATE TABLE IF NOT EXISTS city_names (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tier INTEGER NOT NULL,
    name TEXT NOT NULL
);

INSERT INTO city_names (tier, name) VALUES 
(1, 'Vindolanda'), (1, 'Novaesium'), (1, 'Eburacum'), (1, 'Deva'), (1, 'Lindum'), (1, 'Corinium'), (1, 'Calleva'), (1, 'Durovernum'), (1, 'Camulodunum'), (1, 'Isca'), (1, 'Viroconium'), (1, 'Glevum'), (1, 'Noviomagus'), (1, 'Durobrivae'), (1, 'Cataractonium'), (1, 'Vinovia'), (1, 'Bremetenacum'), (1, 'Mamucium'), (1, 'Coccium'), (1, 'Verulamium'),
(2, 'Lutetia'), (2, 'Lugdunum'), (2, 'Burdigala'), (2, 'Tolosa'), (2, 'Narbo'), (2, 'Nemausus'), (2, 'Arelate'), (2, 'Massilia'), (2, 'Vienna'), (2, 'Augustodunum'), (2, 'Divodurum'), (2, 'Durocortorum'), (2, 'Samarobriva'), (2, 'Rotomagus'), (2, 'Caesarodunum'), (2, 'Mediolanum'), (2, 'Argentoratum'), (2, 'Vesontio'), (2, 'Aginnum'), (2, 'Aquae'),
(3, 'Tarraco'), (3, 'Emerita'), (3, 'Hispalis'), (3, 'Corduba'), (3, 'Gades'), (3, 'Cartago Nova'), (3, 'Caesaraugusta'), (3, 'Bracara'), (3, 'Asturica'), (3, 'Olisippo'), (3, 'Pax Augusta'), (3, 'Toletum'), (3, 'Saguntum'), (3, 'Ilerda'), (3, 'Dertosa'), (3, 'Acci'), (3, 'Pompaelo'), (3, 'Lucus'), (3, 'Scallabis'), (3, 'Ebora'),
(4, 'Carthago'), (4, 'Hadrumetum'), (4, 'Thysdrus'), (4, 'Utica'), (4, 'Cirta'), (4, 'Lambaesis'), (4, 'Thamugadi'), (4, 'Caesarea'), (4, 'Sitifis'), (4, 'Cuicul'), (4, 'Hippo Regius'), (4, 'Leptis Magna'), (4, 'Oea'), (4, 'Sabratha'), (4, 'Theveste'), (4, 'Capsa'), (4, 'Tacape'), (4, 'Gigthis'), (4, 'Zama'), (4, 'Ammaedara'),
(5, 'Antiochia'), (5, 'Berytus'), (5, 'Tyrus'), (5, 'Sidon'), (5, 'Damascus'), (5, 'Palmyra'), (5, 'Heliopolis'), (5, 'Laodicea'), (5, 'Apamea'), (5, 'Emesa'), (5, 'Hierapolis'), (5, 'Zeugma'), (5, 'Samosata'), (5, 'Edessa'), (5, 'Carrhae'), (5, 'Dura Europos'), (5, 'Seleucia'), (5, 'Cyrrhus'), (5, 'Chalcis'), (5, 'Aradus'),
(6, 'Alexandria'), (6, 'Pelusium'), (6, 'Memphis'), (6, 'Oxyrhynchus'), (6, 'Hermopolis'), (6, 'Antinoopolis'), (6, 'Panopolis'), (6, 'Ptolemais'), (6, 'Thebae'), (6, 'Syene'), (6, 'Berenice'), (6, 'Coptos'), (6, 'Latopolis'), (6, 'Apollonopolis'), (6, 'Tentyra'), (6, 'Ombos'), (6, 'Philae'), (6, 'Naucratis'), (6, 'Sais'), (6, 'Bubastis'),
(7, 'Roma'), (7, 'Ostia'), (7, 'Antium'), (7, 'Tarracina'), (7, 'Capua'), (7, 'Neapolis'), (7, 'Pompeii'), (7, 'Salernum'), (7, 'Beneventum'), (7, 'Brundisium'), (7, 'Tarentum'), (7, 'Rhegium'), (7, 'Messana'), (7, 'Syracusae'), (7, 'Catana'), (7, 'Agrigentum'), (7, 'Lilybaeum'), (7, 'Panormus'), (7, 'Thermae'), (7, 'Enna');

-- 3. Create Test User
INSERT INTO users (email, player_name, delivery_hour_utc) 
VALUES ('imtest@gmail.com', 'MehexDaGreaTEST', 12);

-- 4. Assign Tier 1 City to User
INSERT INTO player_states (user_id, city_name)
SELECT id, 'Vindolanda' FROM users WHERE email = 'imtest@gmail.com';
