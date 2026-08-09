CREATE TABLE IF NOT EXISTS restaurants (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    market TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    price_range TEXT NOT NULL DEFAULT '',
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS menu_items (
    id BIGSERIAL PRIMARY KEY,
    restaurant_id BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    image_url TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    average_rating DOUBLE PRECISION,
    rating_count INTEGER,
    source_created_on TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (restaurant_id, name)
);

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('OPEN', 'COLLECTING', 'GRACE', 'MINTING', 'SUBMITTING', 'DECLINED_PROOF_CAPTURED', 'CLOSED', 'CANCELLED')),
    budget_cents INTEGER NOT NULL CHECK (budget_cents >= 0 AND budget_cents <= 30000),
    timer_deadline TIMESTAMPTZ,
    grace_deadline TIMESTAMPTZ,
    channel_id TEXT NOT NULL DEFAULT '',
    restaurant TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS participants (
    id BIGSERIAL PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    slack_user_id TEXT NOT NULL,
    share_cents INTEGER NOT NULL CHECK (share_cents >= 0),
    confirmed_at TIMESTAMPTZ,
    UNIQUE (order_id, slack_user_id)
);

CREATE TABLE IF NOT EXISTS cart_items (
    id BIGSERIAL PRIMARY KEY,
    participant_id BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    menu_item_id BIGINT REFERENCES menu_items(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admins (
    slack_user_id TEXT PRIMARY KEY,
    can_create_orders BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    rain_client_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    delivery_address TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS card_attempts (
    id BIGSERIAL PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    rain_card_id TEXT NOT NULL DEFAULT '',
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0 AND amount_cents <= 30000),
    doordash_request JSONB NOT NULL DEFAULT '{}'::jsonb,
    doordash_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    declined_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS menu_items_restaurant_id_idx ON menu_items(restaurant_id);
CREATE INDEX IF NOT EXISTS menu_items_name_idx ON menu_items(name);
CREATE INDEX IF NOT EXISTS participants_order_id_idx ON participants(order_id);
CREATE INDEX IF NOT EXISTS cart_items_participant_id_idx ON cart_items(participant_id);
CREATE INDEX IF NOT EXISTS card_attempts_order_id_idx ON card_attempts(order_id);
