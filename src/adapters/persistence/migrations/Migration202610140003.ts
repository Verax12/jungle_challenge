import { Migration } from '@mikro-orm/migrations';

export class Migration202610140003 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
create table processing_receipts (
  transaction_id financial_id primary key references wager_transactions(id) deferrable initially deferred,
  idempotency_key financial_id not null unique, provider_id financial_id not null,
  external_transaction_id financial_id not null, payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('PROCESSED','REJECTED','PENDING_REFERENCE')),
  balance money_amount not null, currency financial_currency not null,
  wallet_version integer not null check (wallet_version >= 1), failure_code text,
  constraint receipts_external unique (provider_id, external_transaction_id),
  check ((status = 'REJECTED') = (failure_code is not null))
);
create trigger receipt_immutable before update or delete on processing_receipts for each row execute function finance_deny_mutation();
create trigger receipt_no_truncate before truncate on processing_receipts execute function finance_deny_mutation();
create function finance_receipt_consistent() returns trigger language plpgsql as $$
declare t wager_transactions; w wallets;
begin
  select * into strict t from wager_transactions where id = new.transaction_id;
  select * into strict w from wallets where id = t.wallet_id;
  if row(new.idempotency_key,new.provider_id,new.external_transaction_id,new.payload_hash,new.status,new.failure_code)
     is distinct from row(t.idempotency_key,t.provider_id,t.external_transaction_id,t.payload_hash,t.status,t.failure_code)
     or row(new.balance,new.currency,new.wallet_version) is distinct from row(w.balance,w.currency,w.version) then
    raise exception 'receipt differs from committed outcome' using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger receipt_consistent after insert on processing_receipts
  deferrable initially deferred for each row execute function finance_receipt_consistent();
`);
  }
  override async down(): Promise<void> {
    this.addSql(
      'drop table processing_receipts; drop function finance_receipt_consistent();',
    );
  }
}
