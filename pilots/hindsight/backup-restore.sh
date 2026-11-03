#!/usr/bin/env bash
# Destructive fixture limited to ephemeral GitHub CI PostgreSQL databases.
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${PILOT_STORAGE_FIXTURE:-}" = true
test -n "${POSTGRES_CONTAINER_ID:-}"
task_backup_dir=$(mktemp -d)
trap 'rm -rf "$task_backup_dir"' EXIT
createdb avl419_fixture
createdb avl419_restore
psql -X -v ON_ERROR_STOP=1 -d avl419_fixture <<'SQL'
CREATE EXTENSION vector;
CREATE TABLE synthetic_memory (id integer PRIMARY KEY, text_value text NOT NULL, embedding vector(3));
INSERT INTO synthetic_memory VALUES (1, 'synthetic-decision-419', '[1,0,0]');
SQL
pg_dump -Fc -d avl419_fixture -f "$task_backup_dir/memory.dump"
sha256sum "$task_backup_dir/memory.dump" > "$task_backup_dir/SHA256SUMS"
sha256sum -c "$task_backup_dir/SHA256SUMS"
docker restart "$POSTGRES_CONTAINER_ID" >/dev/null
for task_attempt in {1..10}; do
  if pg_isready -q; then break; fi
  sleep 1
done
test "$(psql -XAt -d avl419_fixture -c 'SELECT count(*) FROM synthetic_memory')" = 1
pg_restore --exit-on-error --no-owner -d avl419_restore "$task_backup_dir/memory.dump"
test "$(psql -XAt -d avl419_restore -c "SELECT text_value FROM synthetic_memory ORDER BY embedding <=> '[1,0,0]' LIMIT 1")" = synthetic-decision-419
# A bad release changes the disposable working DB; rollback uses the clean restore.
psql -X -v ON_ERROR_STOP=1 -d avl419_fixture -c 'DELETE FROM synthetic_memory' >/dev/null
test "$(psql -XAt -d avl419_fixture -c 'SELECT count(*) FROM synthetic_memory')" = 0
test "$(psql -XAt -d avl419_restore -c 'SELECT count(*) FROM synthetic_memory')" = 1
mkdir -p reports/hindsight
printf '%s\n' '{"kind":"postgres-vector-fixture","persistence_after_restart":true,"dump_checksum":true,"restore_vector_query":true,"rollback_to_restored_database":true,"hindsight_runtime_restore":false}' > reports/hindsight/storage.json
dropdb avl419_fixture
dropdb avl419_restore
