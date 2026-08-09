ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_state_check;
ALTER TABLE orders ADD CONSTRAINT orders_state_check
    CHECK (state IN ('OPEN', 'COLLECTING', 'GRACE', 'MINTING', 'SUBMITTING', 'DECLINED_PROOF_CAPTURED', 'CLOSED', 'CANCELLED', 'FAILED'));

ALTER TABLE orders ADD COLUMN IF NOT EXISTS collateral_contract_id TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS collateral_chain TEXT NOT NULL DEFAULT '';

ALTER TABLE card_attempts ADD COLUMN IF NOT EXISTS rain_request JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE card_attempts ADD COLUMN IF NOT EXISTS rain_response JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Over-cap mint attempts must be recordable as evidence; the $300 cap lives in Go logic.
ALTER TABLE card_attempts DROP CONSTRAINT IF EXISTS card_attempts_amount_cents_check;
ALTER TABLE card_attempts ADD CONSTRAINT card_attempts_amount_cents_check CHECK (amount_cents >= 0);
