-- Plebs Control — full DB init (MySQL)
-- Safe to re-run: all inserts use INSERT IGNORE

-- ── TABLES ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS level_config (
    level_id           INT         NOT NULL,
    rank_title         VARCHAR(50) NOT NULL,
    term_years         INT         NOT NULL,
    start_population   INT         NOT NULL,
    start_grain        INT         NOT NULL,
    start_treasury     INT         NOT NULL,
    start_anger        INT         NOT NULL,
    harvest_multiplier INT         NOT NULL DEFAULT 4,
    disaster_risk      FLOAT       NOT NULL DEFAULT 0.0,
    growth_threshold   INT         NOT NULL DEFAULT 22,
    PRIMARY KEY (level_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS users (
    id                   INT          NOT NULL AUTO_INCREMENT,
    email                VARCHAR(255) NOT NULL,
    player_name          VARCHAR(255) NOT NULL,
    delivery_hour_utc    INT          NOT NULL DEFAULT 12,
    verified             TINYINT(1)   NOT NULL DEFAULT 0,
    current_tier         INT          NOT NULL DEFAULT 1,
    day_in_tier          INT          NOT NULL DEFAULT 1,
    verification_token   VARCHAR(255),
    verification_expires BIGINT,
    pending_tax          INT,
    pending_grain        INT,
    pending_buy          INT          DEFAULT 0,
    pending_sell         INT          DEFAULT 0,
    pending_tier         INT,
    pending_treasury     INT,
    PRIMARY KEY (id),
    UNIQUE KEY uq_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS player_states (
    user_id          INT          NOT NULL,
    city_name        VARCHAR(100) NOT NULL,
    population       INT          NOT NULL DEFAULT 1000,
    treasury         INT          NOT NULL DEFAULT 0,
    grain_stored     INT          NOT NULL DEFAULT 25000,
    public_anger     INT          NOT NULL DEFAULT 20,
    growth_streak    INT          NOT NULL DEFAULT 0,
    happy_streak     INT          NOT NULL DEFAULT 0,
    next_grain_price INT          NOT NULL DEFAULT 2,
    next_grain_sell_price INT     NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS turn_history (
    id             INT          NOT NULL AUTO_INCREMENT,
    user_id        INT          NOT NULL,
    city_name      VARCHAR(100) NOT NULL,
    tier           INT          NOT NULL,
    year_in_tier   INT          NOT NULL,
    tax_rate       INT          NOT NULL,
    grain_ordered  INT          NOT NULL,
    grain_actual   INT          NOT NULL,
    grain_bought   INT          NOT NULL DEFAULT 0,
    grain_sold     INT          NOT NULL DEFAULT 0,
    pop_start      INT          NOT NULL,
    pop_end        INT          NOT NULL,
    starved        INT          NOT NULL DEFAULT 0,
    treasury_start INT          NOT NULL,
    treasury_end   INT          NOT NULL,
    grain_start    INT          NOT NULL,
    grain_end      INT          NOT NULL,
    anger_start    INT          NOT NULL,
    anger_end      INT          NOT NULL,
    events         TEXT         NOT NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE IF NOT EXISTS city_names (
    id   INT         NOT NULL AUTO_INCREMENT,
    tier INT         NOT NULL,
    name VARCHAR(100) NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

-- ── LEVEL CONFIG ──────────────────────────────────────────────────────────────
--                    id  rank          yrs   pop      grain     treas   ang  harv  disaster  growth
INSERT IGNORE INTO level_config VALUES
(1, 'Duumvir',     5,   1000,    75000,       0, 10, 10, 0.00, 22),
(2, 'Aedile',     10,  10000,   600000,    5000, 10, 12, 0.00, 22),
(3, 'Praetor',    10,  50000,  2500000,   25000, 10,  8, 0.02, 22),
(4, 'Propraetor', 10,  50000,  2000000,   50000, 12,  7, 0.05, 22),
(5, 'Consul',     15,  75000,  1500000,  100000, 30,  9, 0.10, 22),
(6, 'Praefectus', 15, 100000,  2000000,  150000, 30,  9, 0.20, 22),
(7, 'Proconsul',  20, 100000,  2000000,  200000, 30,  5, 0.30, 22);

-- ── CITY NAMES (20 per tier × 7 tiers) ───────────────────────────────────────

INSERT IGNORE INTO city_names (tier, name) VALUES
-- L1: Britannia
(1,'Vindolanda'),(1,'Novaesium'),(1,'Eburacum'),(1,'Deva'),(1,'Lindum'),
(1,'Corinium'),(1,'Calleva'),(1,'Durovernum'),(1,'Camulodunum'),(1,'Isca'),
(1,'Viroconium'),(1,'Glevum'),(1,'Noviomagus'),(1,'Durobrivae'),(1,'Cataractonium'),
(1,'Vinovia'),(1,'Bremetenacum'),(1,'Mamucium'),(1,'Coccium'),(1,'Verulamium'),
-- L2: Gallia
(2,'Lutetia'),(2,'Lugdunum'),(2,'Burdigala'),(2,'Tolosa'),(2,'Narbo'),
(2,'Nemausus'),(2,'Arelate'),(2,'Massilia'),(2,'Vienna'),(2,'Augustodunum'),
(2,'Divodurum'),(2,'Durocortorum'),(2,'Samarobriva'),(2,'Rotomagus'),(2,'Caesarodunum'),
(2,'Mediolanum'),(2,'Argentoratum'),(2,'Vesontio'),(2,'Aginnum'),(2,'Aquae'),
-- L3: Hispania
(3,'Tarraco'),(3,'Emerita'),(3,'Hispalis'),(3,'Corduba'),(3,'Gades'),
(3,'Cartago Nova'),(3,'Caesaraugusta'),(3,'Bracara'),(3,'Asturica'),(3,'Olisippo'),
(3,'Pax Augusta'),(3,'Toletum'),(3,'Saguntum'),(3,'Ilerda'),(3,'Dertosa'),
(3,'Acci'),(3,'Pompaelo'),(3,'Lucus'),(3,'Scallabis'),(3,'Ebora'),
-- L4: Africa
(4,'Carthago'),(4,'Hadrumetum'),(4,'Thysdrus'),(4,'Utica'),(4,'Cirta'),
(4,'Lambaesis'),(4,'Thamugadi'),(4,'Caesarea'),(4,'Sitifis'),(4,'Cuicul'),
(4,'Hippo Regius'),(4,'Leptis Magna'),(4,'Oea'),(4,'Sabratha'),(4,'Theveste'),
(4,'Capsa'),(4,'Tacape'),(4,'Gigthis'),(4,'Zama'),(4,'Ammaedara'),
-- L5: Syria
(5,'Antiochia'),(5,'Berytus'),(5,'Tyrus'),(5,'Sidon'),(5,'Damascus'),
(5,'Palmyra'),(5,'Heliopolis'),(5,'Laodicea'),(5,'Apamea'),(5,'Emesa'),
(5,'Hierapolis'),(5,'Zeugma'),(5,'Samosata'),(5,'Edessa'),(5,'Carrhae'),
(5,'Dura Europos'),(5,'Seleucia'),(5,'Cyrrhus'),(5,'Chalcis'),(5,'Aradus'),
-- L6: Aegyptus
(6,'Alexandria'),(6,'Pelusium'),(6,'Memphis'),(6,'Oxyrhynchus'),(6,'Hermopolis'),
(6,'Antinoopolis'),(6,'Panopolis'),(6,'Ptolemais'),(6,'Thebae'),(6,'Syene'),
(6,'Berenice'),(6,'Coptos'),(6,'Latopolis'),(6,'Apollonopolis'),(6,'Tentyra'),
(6,'Ombos'),(6,'Philae'),(6,'Naucratis'),(6,'Sais'),(6,'Bubastis'),
-- L7: Italia
(7,'Roma'),(7,'Ostia'),(7,'Antium'),(7,'Tarracina'),(7,'Capua'),
(7,'Neapolis'),(7,'Pompeii'),(7,'Salernum'),(7,'Beneventum'),(7,'Brundisium'),
(7,'Tarentum'),(7,'Rhegium'),(7,'Messana'),(7,'Syracusae'),(7,'Catana'),
(7,'Agrigentum'),(7,'Lilybaeum'),(7,'Panormus'),(7,'Thermae'),(7,'Enna');
