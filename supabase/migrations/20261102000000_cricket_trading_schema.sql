-- ============================================================================
-- Supabase PostgreSQL Migration: Cricket Trading & Match Odds Schema
-- Migration: 20261102000000_cricket_trading_schema.sql
-- Description: Normalized relational schema for Crex live cricket feeds,
--              getSV3 odds integration, multi-rule strategy engine, and trading positions.
-- ============================================================================

-- Enable required extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- ENUM TYPES
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE match_status_enum AS ENUM ('upcoming', 'live', 'completed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE position_type_enum AS ENUM ('FIRST_ENTRY', 'SECOND_ENTRY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE position_status_enum AS ENUM (
    'NONE',
    'CANDIDATE_DETECTED',
    'RECORDED_ENTRY',
    'EXIT_CANDIDATE_DETECTED',
    'RECORDED_EXIT',
    'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE signal_status_enum AS ENUM ('PASS', 'FAIL', 'DATA UNAVAILABLE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE signal_type_enum AS ENUM (
    'ABNORMAL_ACTIVITY_FOUR',
    'ABNORMAL_ACTIVITY_SIX',
    'FIRST_ENTRY_CANDIDATE',
    'FIRST_BOOKSET_TARGET',
    'SECOND_ENTRY_CANDIDATE',
    'SECOND_BOOKSET_TARGET',
    'WICKET_EVENT'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE match_event_type_enum AS ENUM (
    'WICKET',
    'FOUR',
    'SIX',
    'INNINGS_BREAK',
    'TOSS',
    'RESULT',
    'STUMPS',
    'RAIN_DELAY'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 1. TEAMS (Participants Master)
-- Stores canonical participant metadata, colors, and abbreviations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_team_key VARCHAR(32) NOT NULL UNIQUE, -- e.g. 'O' (India), '50' (SYS-W), '4T' (HBH-W)
  name VARCHAR(128) NOT NULL,
  short_name VARCHAR(32) NOT NULL,
  color VARCHAR(32) DEFAULT '#2563eb',
  dark_color VARCHAR(32) DEFAULT '#1e3a8a',
  text_color VARCHAR(32) DEFAULT '#ffffff',
  flag_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_external_key ON teams(external_team_key);

-- ============================================================================
-- 2. MATCHES (Core Catalog)
-- Normalized match records separating external provider IDs from internal UUIDs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_match_id VARCHAR(32) NOT NULL UNIQUE, -- e.g. '12JG', '13QR', '14H6'
  dt_id VARCHAR(64),                              -- Discrete provider ID (e.g. '3377699741002338')
  format VARCHAR(32) NOT NULL,                    -- 'T20I', 'ODI', 'Test', 'T20'
  match_title_prefix VARCHAR(128),
  series_key VARCHAR(32),
  series_name VARCHAR(256),
  venue_key VARCHAR(32),
  venue_name VARCHAR(256),
  team1_id UUID NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  team2_id UUID NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  start_time TIMESTAMPTZ NOT NULL,
  finish_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matches_external_id ON matches(external_match_id);
CREATE INDEX IF NOT EXISTS idx_matches_dt_id ON matches(dt_id);
CREATE INDEX IF NOT EXISTS idx_matches_start_time ON matches(start_time DESC);

-- ============================================================================
-- 3. MATCH TO ODDS KEY MAPPINGS
-- Explicitly validates and pairs matches to their odds endpoint lookup key.
-- ============================================================================

CREATE TABLE IF NOT EXISTS match_odds_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  odds_key VARCHAR(32) NOT NULL,
  masked_key VARCHAR(32) NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  dt_id_matched BOOLEAN,
  teams_matched BOOLEAN,
  verification_reason TEXT,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(match_id, odds_key)
);

CREATE INDEX IF NOT EXISTS idx_match_odds_keys_lookup ON match_odds_keys(odds_key);

-- ============================================================================
-- 4. LATEST MATCH STATE (Current 1:1 Snapshot)
-- Stores the latest live scoreboard without polluting historical tables.
-- ============================================================================

CREATE TABLE IF NOT EXISTS latest_match_state (
  match_id UUID PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  status match_status_enum NOT NULL DEFAULT 'upcoming',
  status_label VARCHAR(128) NOT NULL,
  status_detail TEXT,
  result_text TEXT,
  session_text TEXT,
  current_innings INT NOT NULL DEFAULT 1,
  batting_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  target INT,
  required_run_rate NUMERIC(6, 2),
  current_run_rate NUMERIC(6, 2),
  win_prob_team1 INT,
  win_prob_team2 INT,
  favorite_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  
  -- Innings 1 score
  team1_score_runs INT,
  team1_score_wickets INT,
  team1_score_overs NUMERIC(5, 1),
  team1_score_raw TEXT,
  
  -- Innings 2 score
  team2_score_runs INT,
  team2_score_wickets INT,
  team2_score_overs NUMERIC(5, 1),
  team2_score_raw TEXT,
  
  -- Raw scores from provider for zero-loss serialization
  raw_score_j TEXT,
  raw_score_k TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_latest_match_state_status ON latest_match_state(status);

-- ============================================================================
-- 5. LATEST ODDS STATE (Current 1:1 Snapshot)
-- Back, lay, rate spread, session markets, and directional price movement.
-- ============================================================================

CREATE TABLE IF NOT EXISTS latest_odds_state (
  match_id UUID PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  odds_key VARCHAR(32) NOT NULL,
  raw_rate_string VARCHAR(64),
  back_rate NUMERIC(6, 2),
  lay_rate NUMERIC(6, 2),
  decimal_back NUMERIC(6, 2),
  decimal_lay NUMERIC(6, 2),
  spread NUMERIC(6, 2),
  is_suspended BOOLEAN NOT NULL DEFAULT false,
  favorite_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  favorite_team_name VARCHAR(128),
  direction VARCHAR(16) DEFAULT 'stable', -- 'up', 'down', 'stable'
  delta_back NUMERIC(6, 2) DEFAULT 0,
  delta_lay NUMERIC(6, 2) DEFAULT 0,
  session_markets JSONB DEFAULT '[]'::jsonb, -- overs, low, high, spread
  speech_names JSONB DEFAULT '{}'::jsonb,    -- speech_names mapping from provider
  latency_ms INT DEFAULT 0,
  last_changed_at TIMESTAMPTZ,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 6. HISTORICAL ODDS SNAPSHOTS (Time-series)
-- Deduplicated, event-driven time-series log with clear data retention rules.
-- ============================================================================

CREATE TABLE IF NOT EXISTS odds_snapshots (
  id BIGSERIAL PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  decimal_back NUMERIC(6, 2),
  decimal_lay NUMERIC(6, 2),
  back_rate NUMERIC(6, 2),
  lay_rate NUMERIC(6, 2),
  spread NUMERIC(6, 2),
  is_suspended BOOLEAN NOT NULL DEFAULT false,
  delta_back NUMERIC(6, 2) DEFAULT 0,
  delta_lay NUMERIC(6, 2) DEFAULT 0,
  trigger_reason VARCHAR(64) NOT NULL DEFAULT 'RATE_CHANGE', -- 'RATE_CHANGE', 'FOUR', 'SIX', 'WICKET'
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_odds_snapshots_match_ts ON odds_snapshots(match_id, timestamp DESC);

-- Automated rolling retention function (keeps active match history; trims aged ticks after 7 days)
CREATE OR REPLACE FUNCTION purge_expired_odds_snapshots()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM odds_snapshots
  WHERE timestamp < NOW() - INTERVAL '7 days';
$$;

-- ============================================================================
-- 7. STRATEGY CONFIGURATIONS (Customizable rule parameters)
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategy_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,                                    -- NULL for system default, UUID for trader-specific profile
  name VARCHAR(128) NOT NULL DEFAULT 'Cricket Trading Strategy',
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INT NOT NULL DEFAULT 1,
  
  -- Abnormal activity rules
  four_min_movement NUMERIC(5, 4) NOT NULL DEFAULT 0.1100,
  six_min_movement NUMERIC(5, 4) NOT NULL DEFAULT 0.1800,
  measured_team_target VARCHAR(32) NOT NULL DEFAULT 'favorite',
  
  -- First entry rules
  first_entry_min_odds NUMERIC(5, 2) NOT NULL DEFAULT 1.85,
  first_entry_max_odds NUMERIC(5, 2) NOT NULL DEFAULT 2.00,
  first_bookset_min NUMERIC(5, 2) NOT NULL DEFAULT 1.45,
  first_bookset_max NUMERIC(5, 2) NOT NULL DEFAULT 1.55,
  
  -- Second entry rules
  requires_confirmed_wicket BOOLEAN NOT NULL DEFAULT true,
  second_entry_opposing_max_exclusive NUMERIC(5, 2) NOT NULL DEFAULT 1.65,
  second_bookset_opposing_min_inclusive NUMERIC(5, 2) NOT NULL DEFAULT 1.85,
  opposing_odds_derivation VARCHAR(32) NOT NULL DEFAULT 'complementary',
  
  -- Windows
  first_innings_max_over NUMERIC(4, 1) NOT NULL DEFAULT 10.0,
  second_innings_max_over NUMERIC(4, 1) NOT NULL DEFAULT 6.0,
  continue_monitoring_exits BOOLEAN NOT NULL DEFAULT true,
  
  ambiguities JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 8. TRADE POSITIONS (First & Second Entry Tracker)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trade_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id UUID,
  position_type position_type_enum NOT NULL,
  status position_status_enum NOT NULL DEFAULT 'NONE',
  candidate_signal_id VARCHAR(128),
  
  -- Entry parameters
  entry_odds NUMERIC(6, 2),
  entry_timestamp TIMESTAMPTZ,
  entry_over NUMERIC(4, 1),
  entry_innings INT,
  entry_wickets INT, -- Anchor wicket counter for confirming subsequent wickets
  
  -- Exit parameters
  exit_odds NUMERIC(6, 2),
  exit_timestamp TIMESTAMPTZ,
  exit_over NUMERIC(4, 1),
  bookset_signal_id VARCHAR(128),
  
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(match_id, position_type, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_positions_match_user ON trade_positions(match_id, user_id);

-- ============================================================================
-- 9. PER-MATCH STRATEGY STATE
-- Maintains the active evaluation state for each match.
-- ============================================================================

CREATE TABLE IF NOT EXISTS match_strategy_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id UUID,
  config_id UUID REFERENCES strategy_configurations(id) ON DELETE SET NULL,
  first_entry_position_id UUID REFERENCES trade_positions(id) ON DELETE SET NULL,
  second_entry_position_id UUID REFERENCES trade_positions(id) ON DELETE SET NULL,
  last_evaluated_over NUMERIC(4, 1) DEFAULT 0,
  last_evaluated_wickets INT DEFAULT 0,
  last_evaluated_odds NUMERIC(6, 2),
  abnormal_activity_count INT DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(match_id, user_id)
);

-- ============================================================================
-- 10. MATCH EVENTS (Wickets, Boundaries, Breaks)
-- Event tracking driving the abnormal activity and wicket validation rules.
-- ============================================================================

CREATE TABLE IF NOT EXISTS match_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  event_type match_event_type_enum NOT NULL,
  innings INT NOT NULL,
  over NUMERIC(4, 1) NOT NULL,
  ball_number INT NOT NULL DEFAULT 0,
  batting_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  runs INT DEFAULT 0,
  wickets INT DEFAULT 0,
  odds_movement NUMERIC(6, 4),
  description TEXT NOT NULL,
  raw_details JSONB DEFAULT '{}'::jsonb,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(match_id, event_type, innings, over, ball_number)
);

CREATE INDEX IF NOT EXISTS idx_match_events_lookup ON match_events(match_id, event_type, timestamp DESC);

-- ============================================================================
-- 11. STRATEGY SIGNALS (Immutable Audit Trail & Duplicate Prevention)
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategy_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  config_id UUID REFERENCES strategy_configurations(id) ON DELETE SET NULL,
  event_dedupe_hash VARCHAR(160) NOT NULL UNIQUE, -- SHA-256 or natural composite key
  signal_type signal_type_enum NOT NULL,
  status signal_status_enum NOT NULL,
  current_innings INT NOT NULL,
  current_over NUMERIC(4, 1) NOT NULL,
  ball_number INT NOT NULL DEFAULT 0,
  
  -- Evaluated odds parameters
  measured_team VARCHAR(128),
  decimal_odds NUMERIC(6, 2),
  previous_decimal_odds NUMERIC(6, 2),
  odds_delta NUMERIC(6, 4),
  opposing_team_odds NUMERIC(6, 2),
  
  rule_evaluated TEXT NOT NULL,
  explanation TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_signals_match_ts ON strategy_signals(match_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_signals_type_status ON strategy_signals(signal_type, status);

-- ============================================================================
-- 12. APPLICATION SETTINGS (Key-Value Store)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(64) PRIMARY KEY,
  user_id UUID, -- NULL for system-wide, UUID for specific user
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS across all tables
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_odds_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE latest_match_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE latest_odds_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE odds_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_strategy_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- 1. Public Read for Live Feeds (Dashboard & Analysis Visitors)
-- Anonymous and authenticated clients can view live scores, odds, and public strategy signals
CREATE POLICY "Public read matches" ON matches FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read teams" ON teams FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read odds keys" ON match_odds_keys FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read match state" ON latest_match_state FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read odds state" ON latest_odds_state FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read odds snapshots" ON odds_snapshots FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read match events" ON match_events FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read strategy signals" ON strategy_signals FOR SELECT TO anon, authenticated USING (true);

-- 2. Strategy Configurations: Public default read, private user modifications
CREATE POLICY "Public read default strategy configs" ON strategy_configurations
  FOR SELECT TO anon, authenticated
  USING (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Authenticated manage strategy configs" ON strategy_configurations
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 3. Trade Positions: Strictly protected per authenticated user
CREATE POLICY "Users read own trade positions" ON trade_positions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own trade positions" ON trade_positions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own trade positions" ON trade_positions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 4. Match Strategy States: Scoped to user session
CREATE POLICY "Users read own strategy states" ON match_strategy_states
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users manage own strategy states" ON match_strategy_states
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 5. Application Settings: Read public settings, update only authenticated/owner
CREATE POLICY "Read app settings" ON app_settings
  FOR SELECT TO anon, authenticated
  USING (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Manage app settings" ON app_settings
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 6. Ingestion Policies (Service Role / Backend Proxy Worker)
-- Service-role bypasses RLS automatically in Supabase, ensuring that the backend
-- ingestion worker (syncGoscorerApi / syncCrexPool) can insert and upsert feed data seamlessly.
