-- ============================================================================
-- Local PostgreSQL Database Schema for Crex Live Cricket Scorer & Trading Strategy
-- File: schema.sql
-- Run this script in pgAdmin, psql, or any PostgreSQL client connected to database "leadhunt".
-- ============================================================================

-- Enable UUID extension (PostgreSQL 13+ has gen_random_uuid() built-in; extensions ensure compatibility)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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
-- ============================================================================

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_team_key VARCHAR(32) NOT NULL UNIQUE,
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
-- ============================================================================

CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_match_id VARCHAR(32) NOT NULL UNIQUE,
  dt_id VARCHAR(64),
  format VARCHAR(32) NOT NULL,
  match_title_prefix VARCHAR(128),
  series_key VARCHAR(32),
  series_name VARCHAR(256),
  venue_key VARCHAR(32),
  venue_name VARCHAR(256),
  team1_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  team2_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finish_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matches_external_id ON matches(external_match_id);
CREATE INDEX IF NOT EXISTS idx_matches_start_time ON matches(start_time DESC);

-- ============================================================================
-- 3. MATCH TO ODDS KEY MAPPINGS
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
-- 4. LATEST MATCH STATE (Current Snapshot)
-- ============================================================================

CREATE TABLE IF NOT EXISTS latest_match_state (
  match_id UUID PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  status VARCHAR(32) NOT NULL DEFAULT 'upcoming',
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
  team1_score_runs INT,
  team1_score_wickets INT,
  team1_score_overs NUMERIC(5, 1),
  team1_score_raw TEXT,
  team2_score_runs INT,
  team2_score_wickets INT,
  team2_score_overs NUMERIC(5, 1),
  team2_score_raw TEXT,
  raw_score_j TEXT,
  raw_score_k TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_latest_match_state_status ON latest_match_state(status);

-- ============================================================================
-- 5. LATEST ODDS STATE
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
  direction VARCHAR(16) DEFAULT 'stable',
  delta_back NUMERIC(6, 2) DEFAULT 0,
  delta_lay NUMERIC(6, 2) DEFAULT 0,
  session_markets JSONB DEFAULT '[]'::jsonb,
  speech_names JSONB DEFAULT '{}'::jsonb,
  latency_ms INT DEFAULT 0,
  last_changed_at TIMESTAMPTZ,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 6. MATCH ODDS TICKS
-- ============================================================================

CREATE TABLE IF NOT EXISTS match_odds_ticks (
  id BIGSERIAL PRIMARY KEY,
  match_id VARCHAR(64),
  odds_key VARCHAR(32) NOT NULL,
  favorite_team VARCHAR(128),
  raw_rate_string VARCHAR(64),
  decimal_back NUMERIC(6, 2),
  decimal_lay NUMERIC(6, 2),
  back_rate NUMERIC(6, 2),
  lay_rate NUMERIC(6, 2),
  session_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_odds_ticks_key_ts ON match_odds_ticks(odds_key, created_at DESC);

-- ============================================================================
-- 7. TRADE POSITIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS trade_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  position_type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'NONE',
  candidate_signal_id VARCHAR(128),
  entry_odds NUMERIC(6, 2),
  entry_timestamp TIMESTAMPTZ,
  entry_over NUMERIC(4, 1),
  entry_innings INT,
  entry_wickets INT,
  exit_odds NUMERIC(6, 2),
  exit_timestamp TIMESTAMPTZ,
  exit_over NUMERIC(4, 1),
  bookset_signal_id VARCHAR(128),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(match_id, position_type)
);

CREATE INDEX IF NOT EXISTS idx_trade_positions_match ON trade_positions(match_id);

-- ============================================================================
-- 8. STRATEGY SIGNALS
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategy_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  event_dedupe_hash VARCHAR(160) NOT NULL UNIQUE,
  signal_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  current_innings INT NOT NULL,
  current_over NUMERIC(4, 1) NOT NULL,
  ball_number INT NOT NULL DEFAULT 0,
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

-- ============================================================================
-- 9. DEDICATED STRATEGY TRADES (Primary Trading Record Table)
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategy_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id VARCHAR(64) NOT NULL,
  match_name VARCHAR(256),
  series_name VARCHAR(256),
  booking_team VARCHAR(128) NOT NULL,
  batting_team VARCHAR(128) NOT NULL,
  bowling_team VARCHAR(128) NOT NULL,
  entry_type VARCHAR(32) NOT NULL,
  innings INT NOT NULL,
  entry_over NUMERIC(4, 1) NOT NULL,
  entry_paise INT NOT NULL,
  entry_decimal NUMERIC(6, 2) NOT NULL,
  entry_wickets INT NOT NULL DEFAULT 0,
  entry_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exit_over NUMERIC(4, 1),
  exit_paise INT,
  exit_decimal NUMERIC(6, 2),
  exit_time TIMESTAMPTZ,
  exit_reason VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(match_id, entry_type)
);

CREATE INDEX IF NOT EXISTS idx_strategy_trades_match ON strategy_trades(match_id);
CREATE INDEX IF NOT EXISTS idx_strategy_trades_status ON strategy_trades(status);

-- ============================================================================
-- 10. APPLICATION SETTINGS (Key-Value Store)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(64) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Seed default Telegram configuration record
-- ============================================================================

INSERT INTO app_settings (key, value, description, updated_at)
VALUES (
  'telegram_config',
  '{
    "enabled": true,
    "botToken": "8972166437:AAGjbREY_bCgJJ77wHTJKZWMwCndj3Pi6JQ",
    "chatId": "-1003980667930",
    "notifyWickets": true,
    "notifyResults": true,
    "notifyOverCompletion": true,
    "notifyPeriodicDigest": true,
    "notifyStrategyEntries": true,
    "digestIntervalMinutes": 3
  }'::jsonb,
  'Default Telegram Bot and Broadcast Notifications Configuration',
  NOW()
)
ON CONFLICT (key) DO NOTHING;
