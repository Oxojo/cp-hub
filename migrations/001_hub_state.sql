-- Single-owner MVP: transactionally lock one aggregate for Web, Discord and jobs.
-- Run automatically on startup; safe to run repeatedly.
CREATE TABLE IF NOT EXISTS hub_state (
  id integer PRIMARY KEY CHECK (id = 1),
  revision bigint NOT NULL DEFAULT 0,
  document jsonb NOT NULL
);
