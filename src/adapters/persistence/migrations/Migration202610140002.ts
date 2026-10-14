import { Migration } from '@mikro-orm/migrations';

export class Migration202610140002 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
alter table wager_transactions drop constraint wager_transactions_wallet_id_player_id_currency_fkey;
alter table wager_transactions add constraint transactions_wallet foreign key (wallet_id)
  references wallets(id) deferrable initially deferred;
create function finance_transaction_wallet_scope() returns trigger language plpgsql as $$
declare t wager_transactions; w wallets;
begin
  select * into strict t from wager_transactions where id = new.id;
  select * into strict w from wallets where id = t.wallet_id;
  if t.player_id <> w.player_id then
    if t.status <> 'REJECTED' or t.failure_code is distinct from 'WALLET_MISMATCH' then
      raise exception 'transaction player differs from wallet' using errcode = '23503';
    end if;
  elsif t.currency <> w.currency then
    if t.status <> 'REJECTED' or t.failure_code is distinct from 'CURRENCY_MISMATCH' then
      raise exception 'transaction currency differs from wallet' using errcode = '23503';
    end if;
  end if;
  return null;
end $$;
create constraint trigger transaction_wallet_scope after insert or update on wager_transactions
  deferrable initially deferred for each row execute function finance_transaction_wallet_scope();
`);
  }
  override async down(): Promise<void> {
    this.addSql(`
drop trigger transaction_wallet_scope on wager_transactions;
drop function finance_transaction_wallet_scope();
alter table wager_transactions drop constraint transactions_wallet;
alter table wager_transactions add constraint wager_transactions_wallet_id_player_id_currency_fkey
  foreign key (wallet_id,player_id,currency) references wallets(id,player_id,currency) deferrable initially deferred;
`);
  }
}
