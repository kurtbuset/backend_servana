-- Push notification subscriptions for web agents
CREATE TABLE IF NOT EXISTS push_subscription (
    id bigserial PRIMARY KEY,
    sys_user_id bigint NOT NULL REFERENCES sys_user(sys_user_id) ON DELETE CASCADE,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT push_subscription_endpoint_unique UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscription_sys_user_id_idx ON push_subscription(sys_user_id);
