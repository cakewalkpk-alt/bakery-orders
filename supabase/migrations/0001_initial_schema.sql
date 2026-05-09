  -- ============================================================
  -- 0001_initial_schema.sql
  -- Run in Supabase Dashboard → SQL Editor
  -- ============================================================

  -- ============================================================
  -- updated_at TRIGGER FUNCTION
  -- ============================================================

  create or replace function set_updated_at()
  returns trigger language plpgsql as $$
  begin
    new.updated_at = now();
    return new;
  end;
  $$;

  -- ============================================================
  -- TABLE: businesses
  -- ============================================================

  create table businesses (
    id                                uuid        primary key default gen_random_uuid(),
    name                              text        not null,
    slug                              text        not null unique,
    whatsapp_phone_number_id          text        not null,
    whatsapp_access_token_encrypted   text,
    whatsapp_business_account_id      text        not null,
    whatsapp_template_name            text,
    business_hours_start              int         not null default 9,
    business_hours_end                int         not null default 18,
    timezone                          text        not null default 'Asia/Karachi',
    reminder_1_after_minutes          int         not null default 120,
    reminder_2_after_minutes          int         not null default 1440,
    team_notify_emails                text[]      not null default '{}',
    team_notify_whatsapp_numbers      text[]      not null default '{}',
    google_sheet_id                   text,
    subscription_status               text        not null default 'trial',
    trial_ends_at                     timestamptz,
    created_at                        timestamptz not null default now(),
    updated_at                        timestamptz not null default now()
  );

  create trigger businesses_set_updated_at
    before update on businesses
    for each row execute function set_updated_at();

  -- ============================================================
  -- TABLE: orders
  -- ============================================================

  create table orders (
    id                   uuid        primary key default gen_random_uuid(),
    business_id          uuid        not null references businesses(id) on delete cascade,
    external_order_id    text        not null,
    customer_name        text        not null,
    customer_phone       text        not null,
    items                jsonb       not null default '[]',
    total_amount         numeric(10, 2) not null,
    currency             text        not null default 'PKR',
    payment_method       text        not null,
    delivery_address     text,
    status               text        not null default 'pending_confirmation',
    status_updated_by    text,
    whatsapp_message_id  text,
    reminder_1_sent_at   timestamptz,
    reminder_2_sent_at   timestamptz,
    confirmed_at         timestamptz,
    cancelled_at         timestamptz,
    team_notes           text,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now(),

    constraint uq_orders_business_external unique (business_id, external_order_id),

    constraint chk_payment_method check (
      payment_method in ('cod', 'paid')
    ),

    constraint chk_status check (
      status in (
        'pending_confirmation',
        'confirmed',
        'rejected_by_customer',
        'cancelled_no_response',
        'cancelled_by_team',
        'calling_customer'
      )
    )
  );

  create trigger orders_set_updated_at
    before update on orders
    for each row execute function set_updated_at();

  -- ============================================================
  -- TABLE: order_events
  -- ============================================================

  create table order_events (
    id           uuid        primary key default gen_random_uuid(),
    order_id     uuid        not null references orders(id) on delete cascade,
    business_id  uuid        not null references businesses(id) on delete cascade,
    event_type   text        not null,
    event_data   jsonb       not null default '{}',
    created_at   timestamptz not null default now()
  );

  -- ============================================================
  -- INDEXES
  -- ============================================================

  create index idx_orders_business_status      on orders(business_id, status);
  create index idx_orders_business_created_at  on orders(business_id, created_at desc);
  create index idx_orders_whatsapp_message_id  on orders(whatsapp_message_id);
  create index idx_order_events_order          on order_events(order_id, created_at desc);

  -- ============================================================
  -- ROW LEVEL SECURITY
  -- Enabled on all tables. No policies written yet — all non-service-role
  -- access is blocked by default until policies are added.
  -- ============================================================

  alter table businesses  enable row level security;
  alter table orders      enable row level security;
  alter table order_events enable row level security;
