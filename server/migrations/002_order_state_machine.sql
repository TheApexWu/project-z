ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_state_check;
ALTER TABLE orders ADD CONSTRAINT orders_state_check CHECK (state IN ('OPEN', 'COLLECTING', 'GRACE', 'MINTING', 'SUBMITTING', 'DECLINED_PROOF_CAPTURED', 'CLOSED', 'CANCELLED'));
CREATE INDEX IF NOT EXISTS orders_deadline_idx ON orders (state, timer_deadline, grace_deadline);
