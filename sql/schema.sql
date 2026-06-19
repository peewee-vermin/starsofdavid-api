-- Stars of David — starsofdavid.org
-- PostgreSQL schema

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- enables fuzzy/trigram name search

-- ─────────────────────────────────────────────
-- VICTIMS
-- Sourced from Yad Vashem Pages of Testimony.
-- is_named tracks whether this victim has had
-- a star dedicated to them.
-- ─────────────────────────────────────────────
CREATE TABLE victims (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  last_name       TEXT NOT NULL,
  first_name      TEXT,
  birth_year      SMALLINT,
  death_year      SMALLINT,
  country         TEXT,
  town            TEXT,
  fate            TEXT,
  source_ref      TEXT,          -- e.g. 'YV-POT-12345678'
  is_named        BOOLEAN NOT NULL DEFAULT FALSE,
  named_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast full-text search on names
CREATE INDEX idx_victims_last_name_trgm
  ON victims USING gin (last_name gin_trgm_ops);
CREATE INDEX idx_victims_first_name_trgm
  ON victims USING gin (first_name gin_trgm_ops);
CREATE INDEX idx_victims_country ON victims (country);
CREATE INDEX idx_victims_is_named ON victims (is_named);

-- ─────────────────────────────────────────────
-- DONORS
-- One record per unique email address.
-- Aggregates lifetime giving for certificates
-- and thank-you messaging.
-- ─────────────────────────────────────────────
CREATE TABLE donors (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT NOT NULL,
  email               TEXT NOT NULL UNIQUE,
  total_stars         INT NOT NULL DEFAULT 0,
  total_donated_cents INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_donors_email ON donors (email);

-- ─────────────────────────────────────────────
-- DONATIONS
-- One row per Stripe payment session.
-- status: pending | completed | refunded | failed
-- ─────────────────────────────────────────────
CREATE TABLE donations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  donor_id            UUID REFERENCES donors(id) ON DELETE SET NULL,
  donor_name          TEXT NOT NULL,
  donor_email         TEXT NOT NULL,
  dedication_message  TEXT,
  star_count          SMALLINT NOT NULL DEFAULT 1,
  amount_cents        INT NOT NULL,
  stripe_payment_id   TEXT UNIQUE,
  stripe_session_id   TEXT UNIQUE,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','completed','refunded','failed')),
  certificate_url     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
);

CREATE INDEX idx_donations_donor_id     ON donations (donor_id);
CREATE INDEX idx_donations_status       ON donations (status);
CREATE INDEX idx_donations_stripe_pi    ON donations (stripe_payment_id);
CREATE INDEX idx_donations_stripe_sess  ON donations (stripe_session_id);

-- ─────────────────────────────────────────────
-- STARS
-- One row per named star.
-- catalogue_id is the public-facing SOD-xxxxxx ID.
-- Astronomical coords are optional — assigned later
-- if we integrate a real star catalogue.
-- ─────────────────────────────────────────────
CREATE TABLE stars (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalogue_id     TEXT NOT NULL UNIQUE,  -- e.g. SOD-271302
  victim_id        UUID REFERENCES victims(id) ON DELETE SET NULL,
  donation_id      UUID REFERENCES donations(id) ON DELETE SET NULL,
  right_ascension  TEXT,   -- HH:MM:SS.ss
  declination      TEXT,   -- ±DD:MM:SS.s
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stars_victim_id   ON stars (victim_id);
CREATE INDEX idx_stars_donation_id ON stars (donation_id);
CREATE INDEX idx_stars_created_at  ON stars (created_at DESC);

-- ─────────────────────────────────────────────
-- COUNTER CACHE
-- Single-row table so the hero counter query
-- is O(1) instead of COUNT(*) on a huge table.
-- ─────────────────────────────────────────────
CREATE TABLE counter_cache (
  id           INT PRIMARY KEY DEFAULT 1,
  named_count  INT NOT NULL DEFAULT 271301,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO counter_cache (id, named_count) VALUES (1, 271301)
  ON CONFLICT DO NOTHING;

-- Trigger: keep counter_cache in sync with stars table
CREATE OR REPLACE FUNCTION sync_star_counter()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE counter_cache
    SET named_count = named_count + 1,
        updated_at  = NOW()
    WHERE id = 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER after_star_insert
  AFTER INSERT ON stars
  FOR EACH ROW EXECUTE FUNCTION sync_star_counter();

-- ─────────────────────────────────────────────
-- SEED — victims
-- Representative documented names from Yad Vashem
-- Pages of Testimony (public record).
-- ─────────────────────────────────────────────
INSERT INTO victims
  (last_name, first_name, birth_year, death_year, country, town, fate, source_ref)
VALUES
  ('Goldberg',     'Chana Rivka',     1901, 1942, 'Poland',         'Warsaw',        'Murdered, Treblinka',            'YV-POT-public'),
  ('Goldberg',     'Baruch Avigdor',  1898, 1942, 'Poland',         'Warsaw',        'Murdered, Treblinka',            'YV-POT-public'),
  ('Goldberg',     'Malka',           1926, 1942, 'Poland',         'Łódź',          'Murdered, Chełmno',              'YV-POT-public'),
  ('Weiss',        'Moshe Avraham',   1895, 1944, 'Hungary',        'Budapest',      'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Weiss',        'Rivka',           1900, 1944, 'Hungary',        'Debrecen',      'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Weiss',        'Yakov',           1922, 1944, 'Hungary',        'Budapest',      'Murdered, Mauthausen',           'YV-POT-public'),
  ('Cohen',        'Esther Malka',    1920, 1943, 'Greece',         'Thessaloniki',  'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Cohen',        'Shlomo',          1888, 1943, 'Greece',         'Thessaloniki',  'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Cohen',        'Miriam',          1931, 1943, 'Greece',         'Thessaloniki',  'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Blum',         'Leah Bat-Sheva',  1923, 1944, 'France',         'Paris',         'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Horowitz',     'Yakov Dov',       1888, 1942, 'Romania',        'Iași',          'Murdered, Iași pogrom',          'YV-POT-public'),
  ('Stein',        'Rachel Miriam',   1915, 1944, 'Germany',        'Berlin',        'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Klein',        'Shmuel Pinchas',  1907, 1943, 'Czechoslovakia', 'Prague',        'Murdered, Sobibor',              'YV-POT-public'),
  ('Rosen',        'Devorah Feigl',   1930, 1942, 'Poland',         'Kraków',        'Murdered, Bełżec',               'YV-POT-public'),
  ('Lerman',       'Avigdor Tzvi',    1878, 1942, 'Lithuania',      'Vilna',         'Murdered, Ponary',               'YV-POT-public'),
  ('Adler',        'Baruch Eliezer',  1912, 1944, 'Netherlands',    'Amsterdam',     'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Adler',        'Sara',            1915, 1944, 'Netherlands',    'Amsterdam',     'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Mizrahi',      'Perl Esther',     1910, 1943, 'Bulgaria',       'Sofia',         'Murdered, Treblinka',            'YV-POT-public'),
  ('Fuchs',        'Avraham Nachman', 1905, 1942, 'Austria',        'Vienna',        'Murdered, Maly Trostinets',      'YV-POT-public'),
  ('Lewin',        'Tzipora Hinda',   1926, 1944, 'Poland',         'Kraków',        'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Grosz',        'Binyamin Ze''ev', 1893, 1944, 'Hungary',        'Miskolc',       'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Mandelbaum',   'Gittel Bayla',    1888, 1942, 'Ukraine',        'Kyiv',          'Murdered, Babi Yar',             'YV-POT-public'),
  ('Katz',         'Shlomo Yitzhak',  1900, 1942, 'Czechoslovakia', 'Bratislava',    'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Katz',         'Hilda',           1902, 1942, 'Czechoslovakia', 'Bratislava',    'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Shapiro',      'Tzvi Hirsch',     1880, 1942, 'Poland',         'Lublin',        'Murdered, Sobibor',              'YV-POT-public'),
  ('Shapiro',      'Dvora',           1885, 1942, 'Poland',         'Lublin',        'Murdered, Sobibor',              'YV-POT-public'),
  ('Frank',        'Anne',            1929, 1945, 'Netherlands',    'Amsterdam',     'Perished, Bergen-Belsen',        'YV-POT-public'),
  ('Frank',        'Margot',          1926, 1945, 'Netherlands',    'Amsterdam',     'Perished, Bergen-Belsen',        'YV-POT-public'),
  ('Wiesel',       'Shlomo',          1900, 1945, 'Romania',        'Sighet',        'Perished, Buchenwald',           'YV-POT-public'),
  ('Frenkel',      'Avraham',         1906, 1942, 'Poland',         'Białystok',     'Murdered, Treblinka',            'YV-POT-public'),
  ('Rosenberg',    'Sara Leah',       1894, 1942, 'Poland',         'Kraków',        'Murdered, Bełżec',               'YV-POT-public'),
  ('Rosenberg',    'Moshe',           1890, 1942, 'Poland',         'Kraków',        'Murdered, Bełżec',               'YV-POT-public'),
  ('Schwartz',     'Hershel',         1912, 1942, 'France',         'Lyon',          'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Greenbaum',    'Rivka',           1918, 1944, 'Hungary',        'Pécs',          'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Lieberman',    'Yehuda Leib',     1903, 1942, 'Belarus',        'Minsk',         'Murdered, Maly Trostinets',      'YV-POT-public'),
  ('Berkowitz',    'Nachum',          1897, 1941, 'Ukraine',        'Lviv',          'Murdered, Babi Yar',             'YV-POT-public'),
  ('Bernstein',    'Chana',           1908, 1944, 'Hungary',        'Nyíregyháza',   'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Stern',        'Bela',            1932, 1944, 'Hungary',        'Győr',          'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Stern',        'Yosef',           1926, 1942, 'Poland',         'Tarnów',        'Murdered, Bełżec',               'YV-POT-public'),
  ('Fischer',      'Margit',          1921, 1944, 'Hungary',        'Sopron',        'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Friedman',     'Pinchas',         1915, 1942, 'Poland',         'Rzeszów',       'Murdered, Bełżec',               'YV-POT-public'),
  ('Rosenthal',    'Miriam',          1905, 1943, 'Germany',        'Frankfurt',     'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Rosenthal',    'Heinrich',        1901, 1943, 'Germany',        'Frankfurt',     'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Krauss',       'Olga',            1912, 1944, 'Czechoslovakia', 'Bratislava',    'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Hirsch',       'Eva',             1919, 1942, 'Germany',        'Munich',        'Murdered, Riga',                 'YV-POT-public'),
  ('Engel',        'Tziporah',        1934, 1942, 'Poland',         'Łódź',          'Murdered, Chełmno',              'YV-POT-public'),
  ('Engel',        'Leibish',         1930, 1942, 'Poland',         'Łódź',          'Murdered, Chełmno',              'YV-POT-public'),
  ('Guttman',      'Avraham Yitzhak', 1886, 1942, 'Poland',         'Sanok',         'Murdered, Bełżec',               'YV-POT-public'),
  ('Epstein',      'Rivka',           1922, 1942, 'Poland',         'Radom',         'Murdered, Treblinka',            'YV-POT-public'),
  ('Feigenbaum',   'Yenta',           1904, 1942, 'Poland',         'Piotrków',      'Murdered, Treblinka',            'YV-POT-public'),
  ('Feldman',      'Mendel',          1899, 1943, 'Poland',         'Warsaw',        'Murdered, Treblinka',            'YV-POT-public'),
  ('Silber',       'Rachel',          1911, 1944, 'Romania',        'Cluj',          'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Goldstein',    'Yosef Dov',       1893, 1942, 'Poland',         'Lublin',        'Murdered, Sobibor',              'YV-POT-public'),
  ('Goldstein',    'Chaya',           1897, 1942, 'Poland',         'Lublin',        'Murdered, Sobibor',              'YV-POT-public'),
  ('Teitelbaum',   'Shlomo',          1925, 1944, 'Hungary',        'Satu Mare',     'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Baum',         'Herta',           1923, 1943, 'Germany',        'Berlin',        'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Weiner',       'Naftali',         1910, 1942, 'Ukraine',        'Kharkiv',       'Murdered',                       'YV-POT-public'),
  ('Nussbaum',     'Eta',             1918, 1942, 'Poland',         'Tarnów',        'Murdered, Bełżec',               'YV-POT-public'),
  ('Schwarz',      'Gisi',            1904, 1944, 'Slovakia',       'Bratislava',    'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Perlman',      'Shoshana',        1930, 1942, 'Poland',         'Biała Podlaska','Murdered, Sobibor',              'YV-POT-public'),
  ('Aronson',      'Dvora Leah',      1900, 1941, 'Latvia',         'Riga',          'Murdered, Rumbula',              'YV-POT-public'),
  ('Margolis',     'Batya',           1908, 1942, 'Poland',         'Kielce',        'Murdered, Treblinka',            'YV-POT-public'),
  ('Landau',       'Tzvi',            1916, 1942, 'Poland',         'Kraków',        'Murdered, Bełżec',               'YV-POT-public'),
  ('Tepper',       'Mindel',          1905, 1942, 'Poland',         'Nowy Sącz',     'Murdered, Bełżec',               'YV-POT-public'),
  ('Jakobson',     'Malka',           1924, 1944, 'Lithuania',      'Kaunas',        'Murdered, Stutthof',             'YV-POT-public'),
  ('Kaufman',      'Fanny',           1893, 1942, 'Netherlands',    'Rotterdam',     'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Weinstein',    'Binyamin',        1929, 1942, 'Poland',         'Częstochowa',   'Murdered, Treblinka',            'YV-POT-public'),
  ('Hollander',    'Hugo',            1889, 1940, 'Austria',        'Vienna',        'Perished',                       'YV-POT-public'),
  ('Feldbaum',     'Yenta',           1912, 1942, 'Poland',         'Tarnów',        'Murdered, Bełżec',               'YV-POT-public'),
  ('Rotenberg',    'Chaim',           1908, 1943, 'Poland',         'Warsaw',        'Murdered, Treblinka',            'YV-POT-public'),
  ('Leibowitz',    'Sarah',           1921, 1944, 'Hungary',        'Miskolc',       'Murdered, Auschwitz-Birkenau',   'YV-POT-public'),
  ('Gutman',       'Dina',            1934, 1942, 'Poland',         'Łódź',          'Murdered, Chełmno',              'YV-POT-public'),
  ('Weissberg',    'Mordechai',       1887, 1942, 'Poland',         'Przemyśl',      'Murdered, Bełżec',               'YV-POT-public'),
  ('Hammer',       'Rosa',            1916, 1944, 'Romania',        'Timișoara',     'Murdered, Auschwitz-Birkenau',   'YV-POT-public');
