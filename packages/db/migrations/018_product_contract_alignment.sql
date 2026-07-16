-- Migration: 018_product_contract_alignment
-- Created: 2026-07-15
-- Description: Align persisted product constraints with the versioned application contracts.

CREATE UNIQUE INDEX IF NOT EXISTS user_wallets_active_chain_address_idx
  ON user_wallets(chain_id, address)
  WHERE deleted_at IS NULL;

ALTER TABLE user_security_events DROP CONSTRAINT IF EXISTS user_security_events_event_type_check;
ALTER TABLE user_security_events ADD CONSTRAINT user_security_events_event_type_check CHECK (
  event_type IN (
    'login', 'logout', 'password_change', 'api_key_created', 'api_key_revoked',
    'suspicious_activity', 'account_locked', 'login_success', 'login_failure',
    'session_revoked', 'wallet_linked', 'wallet_unlinked', 'rate_limit_exceeded',
    'privilege_escalation_attempt'
  )
);

ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_rule_type_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_rule_type_check CHECK (
  rule_type IN (
    'price', 'volume', 'liquidity', 'transfer', 'approval', 'custom', 'price_change',
    'volume_spike', 'large_transfer', 'contract_event', 'risk_score_change',
    'governance_proposal'
  )
);

ALTER TABLE watchlist_items DROP CONSTRAINT IF EXISTS watchlist_items_target_type_check;
ALTER TABLE watchlist_items ADD CONSTRAINT watchlist_items_target_type_check CHECK (
  target_type IN ('token', 'wallet', 'contract', 'project')
);

ALTER TABLE alert_events DROP CONSTRAINT IF EXISTS alert_events_severity_check;
ALTER TABLE alert_events ADD CONSTRAINT alert_events_severity_check CHECK (
  severity IN ('info', 'warning', 'low', 'medium', 'high', 'critical')
);

ALTER TABLE project_contracts DROP CONSTRAINT IF EXISTS project_contracts_contract_type_check;
ALTER TABLE project_contracts ADD CONSTRAINT project_contracts_contract_type_check CHECK (
  contract_type IN (
    'token', 'staking', 'governance', 'treasury', 'bond', 'vesting', 'factory', 'router', 'other'
  )
);

ALTER TABLE project_claims DROP CONSTRAINT IF EXISTS project_claims_claim_type_check;
ALTER TABLE project_claims ADD CONSTRAINT project_claims_claim_type_check CHECK (
  claim_type IN ('ownership', 'team', 'partner', 'maintainer', 'contributor')
);

ALTER TABLE community_reports DROP CONSTRAINT IF EXISTS community_reports_report_type_check;
ALTER TABLE community_reports ADD CONSTRAINT community_reports_report_type_check CHECK (
  report_type IN (
    'scam', 'phishing', 'rug_pull', 'hack', 'spam', 'honeypot', 'exploit',
    'impersonation', 'other'
  )
);

ALTER TABLE report_evidence DROP CONSTRAINT IF EXISTS report_evidence_evidence_type_check;
ALTER TABLE report_evidence ADD CONSTRAINT report_evidence_evidence_type_check CHECK (
  evidence_type IN (
    'url', 'image', 'document', 'transaction', 'other', 'screenshot', 'transaction_hash',
    'contract_code', 'chat_log'
  )
);

ALTER TABLE report_resolutions DROP CONSTRAINT IF EXISTS report_resolutions_resolution_type_check;
ALTER TABLE report_resolutions ADD CONSTRAINT report_resolutions_resolution_type_check CHECK (
  resolution_type IN ('upheld', 'rejected', 'partial', 'dismissed', 'escalated')
);

ALTER TABLE transaction_intents DROP CONSTRAINT IF EXISTS transaction_intents_intent_type_check;
ALTER TABLE transaction_intents ADD CONSTRAINT transaction_intents_intent_type_check CHECK (
  intent_type IN ('transfer', 'swap', 'approve', 'stake', 'unstake', 'claim', 'vote', 'custom')
);

ALTER TABLE transaction_intents DROP CONSTRAINT IF EXISTS transaction_intents_status_check;
ALTER TABLE transaction_intents ADD CONSTRAINT transaction_intents_status_check CHECK (
  status IN (
    'pending', 'draft', 'simulated', 'signed', 'broadcasted', 'broadcast', 'confirmed', 'failed'
  )
);

ALTER TABLE wallet_labels DROP CONSTRAINT IF EXISTS wallet_labels_label_type_check;
ALTER TABLE wallet_labels ADD CONSTRAINT wallet_labels_label_type_check CHECK (
  label_type IN (
    'exchange', 'defi', 'nft', 'governance', 'bridge', 'miner', 'other', 'ens',
    'defi_protocol', 'whale', 'bot', 'multisig', 'dao', 'custom'
  )
);

ALTER TABLE spender_classifications
  DROP CONSTRAINT IF EXISTS spender_classifications_classification_type_check;
ALTER TABLE spender_classifications
  ADD CONSTRAINT spender_classifications_classification_type_check CHECK (
    classification_type IN (
      'dex', 'lending', 'bridge', 'nft_marketplace', 'governance', 'other', 'dex_router',
      'lending_pool', 'staking', 'aggregator', 'multisig', 'unknown'
    )
  );
