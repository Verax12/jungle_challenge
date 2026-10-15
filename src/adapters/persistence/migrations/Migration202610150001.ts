import { Migration } from '@mikro-orm/migrations';

export class Migration202610150001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
lock table wallets, wager_transactions, wallet_ledger_entries in share row exclusive mode;
do $$
declare invalid_wallet text;
begin
  with chain as (
    select e.*, t.kind,
      lag(e.wallet_version) over wallet_history as previous_version,
      lag(e.balance_after) over wallet_history as previous_balance
    from wallet_ledger_entries e join wager_transactions t on t.id = e.transaction_id
    window wallet_history as (partition by e.wallet_id order by e.wallet_version)
  )
  select wallet_id into invalid_wallet from chain where
    (previous_version is null and not (
      balance_before = 0 and
      ((wallet_version = 1 and kind = 'OPENING') or (wallet_version = 2 and kind <> 'OPENING'))
    )) or
    (previous_version is not null and (
      wallet_version::bigint <> previous_version::bigint + 1 or
      balance_before <> previous_balance or kind = 'OPENING'
    )) limit 1;
  if found then
    raise exception 'existing ledger chain is inconsistent for wallet %', invalid_wallet
      using errcode = '23514', hint = 'Stop writers and investigate the ledger; migration does not repair financial records.';
  end if;
  with totals as (
    select wallet_id, sum(case direction when 'CREDIT' then amount else -amount end) as balance
    from wallet_ledger_entries group by wallet_id
  ), heads as (
    select distinct on (wallet_id) wallet_id, wallet_version, balance_after
    from wallet_ledger_entries order by wallet_id, wallet_version desc
  )
  select w.id into invalid_wallet from wallets w
  left join totals t on t.wallet_id = w.id left join heads h on h.wallet_id = w.id
  where w.balance <> coalesce(t.balance, 0) or
    w.balance <> coalesce(h.balance_after, 0) or w.version <> coalesce(h.wallet_version, 1)
  limit 1;
  if found then
    raise exception 'existing wallet and ledger diverge for wallet %', invalid_wallet
      using errcode = '23514', hint = 'Stop writers and investigate the ledger; migration does not repair financial records.';
  end if;
end $$;

create function finance_ledger_successor_consistent() returns trigger language plpgsql as $$
declare successor wallet_ledger_entries;
begin
  select * into successor from wallet_ledger_entries
    where wallet_id = new.wallet_id and wallet_version > new.wallet_version
    order by wallet_version limit 1;
  if found and (successor.wallet_version::bigint <> new.wallet_version::bigint + 1 or
    successor.balance_before <> new.balance_after) then
    raise exception 'ledger successor diverges' using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger ledger_successor_consistent after insert on wallet_ledger_entries
  deferrable initially deferred for each row execute function finance_ledger_successor_consistent();
`);
  }

  override async down(): Promise<void> {
    this.addSql(`
drop trigger ledger_successor_consistent on wallet_ledger_entries;
drop function finance_ledger_successor_consistent();
`);
  }
}
