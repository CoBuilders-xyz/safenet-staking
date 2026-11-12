-- Unmatched Aegis ceremonies keyed by SID, and the checkpoint facts that the atomic commit checks.
create table alerts_ceremonies (
  sid text primary key,
  ceremony text not null constraint alerts_ceremony_shape check (
    json_valid(ceremony) and json_type(ceremony, '$.shares') = 'object'
    and json_type(ceremony, '$.at') is null and length(cast(ceremony as blob)) <= 65536
  )
) strict;

-- The revision and cursor of the 'aegis' checkpoint, kept beside its JSON so that one statement can
-- compare them. Only the chronology commit writes this row and that checkpoint, in one batch.
create table alerts_chronology (
  id integer primary key check (id = 1), revision integer not null, cursor integer not null
) strict;
insert into alerts_chronology(id, revision, cursor) values (1, 0, 0);

-- D1 has no stored procedures. A batch is one transaction and rolls back when a statement fails.
-- So a commit inserts a row here when a precondition fails, and the named constraint aborts the
-- whole batch. No row is ever stored.
create table alerts_guard (
  lease integer constraint chronology_lease_lost check (lease is null),
  revision integer constraint chronology_revision_changed check (revision is null),
  batch integer constraint invalid_chronology_batch check (batch is null)
) strict;
