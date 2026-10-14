import { Migration } from '@mikro-orm/migrations';

export class Migration202610140001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
create domain financial_id as text check (value <> '' and value = btrim(value));
create domain financial_currency as text check (value in ('BRL', 'USD', 'EUR'));
create domain money_amount as numeric check (
  value >= 0 and value < 1e36::numeric and scale(value) <= 2
);
create table wallets (
  id financial_id primary key, player_id financial_id not null,
  currency financial_currency not null, balance money_amount not null,
  version integer not null check (version >= 1),
  created_at timestamptz not null, updated_at timestamptz not null,
  constraint wallets_identity unique (player_id, currency),
  constraint wallets_scope unique (id, player_id, currency),
  check (updated_at >= created_at)
);
create table wager_transactions (
  id financial_id primary key, provider_id financial_id not null,
  external_transaction_id financial_id not null, idempotency_key financial_id not null unique,
  payload_hash financial_id not null, wallet_id financial_id not null,
  player_id financial_id not null, currency financial_currency not null,
  round_id financial_id not null, game_id financial_id not null,
  kind text not null check (kind in ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
  amount money_amount not null,
  reference_external_transaction_id financial_id,
  reference_transaction_id financial_id references wager_transactions(id) deferrable initially deferred,
  status text not null check (status in ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
  failure_code text,
  created_at timestamptz not null, processed_at timestamptz,
  constraint transactions_external unique (provider_id, external_transaction_id),
  constraint transactions_scope unique (id, wallet_id, currency),
  foreign key (wallet_id, player_id, currency) references wallets(id, player_id, currency) deferrable initially deferred,
  check ((kind = 'LOSS' and amount = 0) or (kind <> 'LOSS' and amount > 0)),
  check (kind not in ('REFUND','ROLLBACK') or reference_external_transaction_id is not null),
  check (kind not in ('BET','LOSS','OPENING') or reference_external_transaction_id is null),
  check (reference_external_transaction_id is distinct from external_transaction_id),
  check (reference_transaction_id is distinct from id),
  check (status <> 'PENDING_REFERENCE' or reference_external_transaction_id is not null),
  check ((status = 'PROCESSED') = (processed_at is not null)),
  check (processed_at is null or processed_at >= created_at),
  check (reference_transaction_id is null or (status = 'PROCESSED' and reference_external_transaction_id is not null)),
  check (status <> 'PROCESSED' or reference_external_transaction_id is null or reference_transaction_id is not null),
  check ((status in ('REJECTED','FAILED')) = (failure_code is not null)),
  check (status <> 'FAILED' or failure_code = 'INFRASTRUCTURE_PERMANENT'),
  check (status <> 'REJECTED' or failure_code in (
    'INVALID_MONEY','UNSUPPORTED_CURRENCY','INVALID_INPUT','CURRENCY_MISMATCH','WALLET_MISMATCH',
    'INSUFFICIENT_FUNDS','REVERSAL_INSUFFICIENT_FUNDS','REFERENCE_REQUIRED','REFERENCE_NOT_ALLOWED',
    'REFERENCE_NOT_FOUND','REFERENCE_NOT_PROCESSED','REFERENCE_SCOPE_MISMATCH','REFERENCE_KIND_MISMATCH',
    'REFERENCE_AMOUNT_MISMATCH','REFERENCE_ALREADY_REVERSED','IDEMPOTENCY_CONFLICT'))
);
create unique index transactions_opening on wager_transactions(wallet_id) where kind = 'OPENING';
create unique index transactions_reversal on wager_transactions(reference_transaction_id, kind)
  where status = 'PROCESSED' and kind in ('REFUND','ROLLBACK');
create index transactions_pending_reference on wager_transactions(created_at, id) where status = 'PENDING_REFERENCE';
create table wallet_ledger_entries (
  id financial_id primary key, wallet_id financial_id not null,
  transaction_id financial_id not null, currency financial_currency not null,
  direction text not null check (direction in ('DEBIT','CREDIT')),
  amount money_amount not null check (amount > 0),
  balance_before money_amount not null, balance_after money_amount not null,
  wallet_version integer not null check (wallet_version >= 1), created_at timestamptz not null,
  constraint ledger_transaction unique (transaction_id, wallet_id),
  constraint ledger_version unique (wallet_id, wallet_version),
  foreign key (transaction_id, wallet_id, currency) references wager_transactions(id, wallet_id, currency) deferrable initially deferred,
  check (balance_after = balance_before + case direction when 'CREDIT' then amount else -amount end)
);
create table inbox_messages (
  consumer_name financial_id not null, message_id financial_id not null, payload_hash financial_id not null,
  received_at timestamptz not null, processed_at timestamptz,
  primary key (consumer_name, message_id), check (processed_at is null or processed_at >= received_at)
);
create table outbox_messages (
  id financial_id primary key, aggregate_id financial_id not null, event_type financial_id not null,
  payload jsonb not null, occurred_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz, published_at timestamptz,
  check (next_attempt_at is null or next_attempt_at >= occurred_at),
  check (published_at is null or (published_at >= occurred_at and next_attempt_at is null)),
  check (jsonb_typeof(payload) = 'object' and
    (jsonb_typeof(payload->'eventId') = 'string') is true and
    (jsonb_typeof(payload->'aggregateId') = 'string') is true and
    (jsonb_typeof(payload->'eventType') = 'string') is true and
    (jsonb_typeof(payload->'version') = 'number') is true and
    (payload->>'eventId' = id) is true and (payload->>'aggregateId' = aggregate_id) is true and
    (payload->>'eventType' = event_type) is true and (payload->>'version' = '1') is true and
    (jsonb_typeof(payload->'data') = 'object') is true and
    (jsonb_typeof(payload->'correlationId') = 'string') is true and
    (jsonb_typeof(payload->'occurredAt') = 'string') is true and
    ((payload->>'occurredAt')::timestamptz = occurred_at) is true)
);
create index outbox_due on outbox_messages(next_attempt_at, occurred_at, id) where published_at is null;

create function finance_deny_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'audit record is immutable: % %', tg_table_name, tg_op using errcode = '23514';
end $$;
create trigger ledger_immutable before update or delete on wallet_ledger_entries for each row execute function finance_deny_mutation();
create trigger wallets_no_delete before delete on wallets for each row execute function finance_deny_mutation();
create trigger transactions_no_delete before delete on wager_transactions for each row execute function finance_deny_mutation();
create trigger inbox_no_delete before delete on inbox_messages for each row execute function finance_deny_mutation();
create trigger outbox_no_delete before delete on outbox_messages for each row execute function finance_deny_mutation();
create trigger wallets_no_truncate before truncate on wallets execute function finance_deny_mutation();
create trigger transactions_no_truncate before truncate on wager_transactions execute function finance_deny_mutation();
create trigger ledger_no_truncate before truncate on wallet_ledger_entries execute function finance_deny_mutation();
create trigger inbox_no_truncate before truncate on inbox_messages execute function finance_deny_mutation();
create trigger outbox_no_truncate before truncate on outbox_messages execute function finance_deny_mutation();

create function finance_wallet_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.version <> 1 then raise exception 'wallet starts at version 1' using errcode = '23514'; end if;
  else
    if row(new.id,new.player_id,new.currency,new.created_at) is distinct from row(old.id,old.player_id,old.currency,old.created_at)
      or new.updated_at < old.updated_at then
      raise exception 'wallet identity or timestamp cannot change' using errcode = '23514';
    end if;
    if (new.balance <> old.balance and new.version <> old.version + 1)
      or (new.balance = old.balance and new.version <> old.version) then
      raise exception 'wallet version must follow balance changes' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger wallet_guard before insert or update on wallets for each row execute function finance_wallet_guard();

create function finance_transaction_guard() returns trigger language plpgsql as $$
begin
  if old.status in ('PROCESSED','REJECTED','FAILED') and new is distinct from old then
    raise exception 'terminal transaction is immutable' using errcode = '23514';
  end if;
  if (to_jsonb(new) - array['status','reference_transaction_id','failure_code','processed_at'])
    is distinct from (to_jsonb(old) - array['status','reference_transaction_id','failure_code','processed_at']) then
    raise exception 'transaction identity and payload are immutable' using errcode = '23514';
  end if;
  if old.status = 'PENDING_REFERENCE' and new.status = 'PENDING' then
    raise exception 'invalid transaction transition' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger transaction_guard before update on wager_transactions for each row execute function finance_transaction_guard();

create function finance_message_guard() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'inbox_messages' then
    if (to_jsonb(new) - 'processed_at') is distinct from (to_jsonb(old) - 'processed_at')
      or (old.processed_at is not null and new is distinct from old) then
      raise exception 'inbox identity or completion is immutable' using errcode = '23514';
    end if;
  else
    if (to_jsonb(new) - array['attempts','next_attempt_at','published_at'])
      is distinct from (to_jsonb(old) - array['attempts','next_attempt_at','published_at'])
      or new.attempts < old.attempts or (old.published_at is not null and new is distinct from old) then
      raise exception 'outbox payload or completion is immutable' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger inbox_guard before update on inbox_messages for each row execute function finance_message_guard();
create trigger outbox_guard before update on outbox_messages for each row execute function finance_message_guard();

create function finance_lock_ledger_wallet() returns trigger language plpgsql as $$
begin
  perform id from wallets where id = new.wallet_id for update;
  return new;
end $$;
create trigger ledger_wallet_lock before insert on wallet_ledger_entries for each row execute function finance_lock_ledger_wallet();

create function finance_wallet_consistent() returns trigger language plpgsql as $$
declare w wallets; head wallet_ledger_entries;
begin
  select * into strict w from wallets where id = new.id for update;
  select * into head from wallet_ledger_entries where wallet_id = w.id order by wallet_version desc limit 1;
  if not found then
    if w.balance <> 0 or w.version <> 1 then raise exception 'wallet balance requires ledger' using errcode = '23514'; end if;
  elsif w.balance <> head.balance_after or w.version <> head.wallet_version then
    raise exception 'wallet and ledger head diverge' using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger wallet_consistent after insert or update on wallets
  deferrable initially deferred for each row execute function finance_wallet_consistent();

create function finance_transaction_consistent() returns trigger language plpgsql as $$
declare t wager_transactions; r wager_transactions; e wallet_ledger_entries; expected_direction text;
begin
  select * into strict t from wager_transactions where id = new.id;
  select * into e from wallet_ledger_entries where transaction_id = t.id and wallet_id = t.wallet_id;
  if t.status <> 'PROCESSED' or t.kind = 'LOSS' then
    if found then raise exception 'unapplied transaction or LOSS cannot have ledger' using errcode = '23514'; end if;
    return null;
  end if;
  if not found then raise exception 'processed transaction requires ledger' using errcode = '23514'; end if;
  expected_direction := case when t.kind = 'BET' then 'DEBIT' else 'CREDIT' end;
  if t.reference_transaction_id is not null then
    select * into r from wager_transactions where id = t.reference_transaction_id;
    if not found or r.status <> 'PROCESSED' or
      row(r.provider_id,r.external_transaction_id,r.player_id,r.wallet_id,r.currency,r.round_id)
      is distinct from row(t.provider_id,t.reference_external_transaction_id,t.player_id,t.wallet_id,t.currency,t.round_id) then
      raise exception 'invalid reference scope or status' using errcode = '23514';
    end if;
    if (t.kind in ('REFUND','WIN') and r.kind <> 'BET') or
      (t.kind = 'ROLLBACK' and r.kind not in ('BET','WIN','REFUND')) then
      raise exception 'invalid reference kind' using errcode = '23514';
    end if;
    if t.kind in ('REFUND','ROLLBACK') and t.amount <> r.amount then
      raise exception 'partial reversal is forbidden' using errcode = '23514';
    end if;
    if t.kind = 'ROLLBACK' then expected_direction := case when r.kind = 'BET' then 'CREDIT' else 'DEBIT' end; end if;
  end if;
  if e.amount <> t.amount or e.direction <> expected_direction or e.created_at <> t.processed_at then
    raise exception 'ledger does not match transaction' using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger transaction_consistent after insert or update on wager_transactions
  deferrable initially deferred for each row execute function finance_transaction_consistent();

create function finance_ledger_consistent() returns trigger language plpgsql as $$
declare w wallets; t wager_transactions; predecessor wallet_ledger_entries; head wallet_ledger_entries;
begin
  select * into strict w from wallets where id = new.wallet_id for update;
  select * into strict t from wager_transactions where id = new.transaction_id;
  if t.status <> 'PROCESSED' or t.kind = 'LOSS' then
    raise exception 'ledger requires processed financial transaction' using errcode = '23514';
  end if;
  if new.wallet_version = 1 then
    if t.kind <> 'OPENING' or new.balance_before <> 0 then raise exception 'invalid opening ledger' using errcode = '23514'; end if;
  else
    if t.kind = 'OPENING' then raise exception 'opening must be first entry' using errcode = '23514'; end if;
    select * into predecessor from wallet_ledger_entries where wallet_id = new.wallet_id and wallet_version = new.wallet_version - 1;
    if not found then
      if new.wallet_version <> 2 or new.balance_before <> 0 then raise exception 'ledger predecessor missing' using errcode = '23514'; end if;
    elsif predecessor.balance_after <> new.balance_before then
      raise exception 'ledger chain diverges' using errcode = '23514';
    end if;
  end if;
  select * into strict head from wallet_ledger_entries where wallet_id = w.id order by wallet_version desc limit 1;
  if w.balance <> head.balance_after or w.version <> head.wallet_version then
    raise exception 'ledger head and wallet diverge' using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger ledger_consistent after insert on wallet_ledger_entries
  deferrable initially deferred for each row execute function finance_ledger_consistent();
`);
  }

  override async down(): Promise<void> {
    this.addSql(`
drop table wallet_ledger_entries, outbox_messages, inbox_messages, wager_transactions, wallets;
drop function finance_ledger_consistent(), finance_transaction_consistent(), finance_wallet_consistent(),
  finance_lock_ledger_wallet(), finance_message_guard(), finance_transaction_guard(), finance_wallet_guard(), finance_deny_mutation();
drop domain money_amount, financial_currency, financial_id;
`);
  }
}
