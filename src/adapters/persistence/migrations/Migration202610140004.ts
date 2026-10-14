import { Migration } from '@mikro-orm/migrations';

export class Migration202610140004 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
create table reference_jobs (
  transaction_id financial_id primary key references wager_transactions(id) deferrable initially deferred,
  correlation_id financial_id not null, causation_id financial_id,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null, expires_at timestamptz not null,
  completed_at timestamptz,
  check (next_attempt_at <= expires_at)
);
create index reference_jobs_due on reference_jobs(next_attempt_at,transaction_id) where completed_at is null;
insert into reference_jobs (transaction_id,correlation_id,causation_id,next_attempt_at,expires_at)
select t.id, coalesce(e.payload->>'correlationId',t.id), e.payload->>'causationId',
  t.created_at + interval '1 second', t.created_at + interval '24 hours'
from wager_transactions t left join lateral (
  select payload from outbox_messages where aggregate_id = t.id and event_type = 'WagerTransactionPendingReference'
  order by occurred_at,id limit 1
) e on true where t.status = 'PENDING_REFERENCE';
create function finance_reference_job_guard() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['attempts','next_attempt_at','completed_at']) is distinct from
     (to_jsonb(old) - array['attempts','next_attempt_at','completed_at'])
     or new.attempts <> old.attempts + 1 or new.next_attempt_at < old.next_attempt_at
     or old.completed_at is not null then
    raise exception 'reference job context and progress are immutable' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger reference_job_guard before update on reference_jobs for each row execute function finance_reference_job_guard();
create trigger reference_job_no_delete before delete on reference_jobs for each row execute function finance_deny_mutation();
create trigger reference_job_no_truncate before truncate on reference_jobs execute function finance_deny_mutation();
create function finance_reference_job_consistent() returns trigger language plpgsql as $$
declare j reference_jobs; t wager_transactions;
begin
  select * into strict j from reference_jobs where transaction_id = new.transaction_id;
  select * into strict t from wager_transactions where id = j.transaction_id;
  if (j.completed_at is null and t.status <> 'PENDING_REFERENCE') or
     (j.completed_at is not null and (t.status not in ('PROCESSED','REJECTED') or j.completed_at < t.created_at)) or
     j.expires_at <> t.created_at + interval '24 hours' then
    raise exception 'reference job differs from transaction outcome' using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger reference_job_consistent after insert or update on reference_jobs
  deferrable initially deferred for each row execute function finance_reference_job_consistent();
`);
  }
  override async down(): Promise<void> {
    this.addSql(
      'drop table reference_jobs; drop function finance_reference_job_guard(); drop function finance_reference_job_consistent();',
    );
  }
}
