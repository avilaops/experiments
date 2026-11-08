import type { Pool, PoolClient } from "pg";
import { ApiError, record } from "../contracts.js";
import { transaction } from "./database.js";
import { changeNote, ENTITIES, IMMUTABLE, parseRecord, property, type Entity } from "./schema.js";

const schema = "experiments_architecture";
function jsonRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [property(key), value instanceof Date ? value.toISOString() : value]));
}
async function currentRevision(client: PoolClient, lock = false): Promise<number> {
  const { rows } = await client.query(`SELECT revision FROM ${schema}.catalog_revision WHERE singleton${lock ? " FOR UPDATE" : ""}`);
  if (rows.length !== 1) throw new Error("Architecture catalog revision is missing");
  return rows[0].revision as number;
}
function databaseError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  const code = (error as { code?: string }).code;
  if (code === "23505") throw new ApiError(409, "DUPLICATE_RECORD", "O cadastro ou vínculo já existe.");
  if (["23503", "23514", "23502", "22P02", "22007", "22008"].includes(code ?? "")) throw new ApiError(400, "INVALID_RELATION", "Referência, vínculo ou valor inválido.");
  if (["40001", "40P01", "55P03", "57014"].includes(code ?? "")) throw new ApiError(409, "DATABASE_CONFLICT", "Operação não confirmada. Consulte a revisão antes de repetir.");
  throw error;
}

export class ArchitectureStore {
  constructor(readonly pool: Pool, readonly actor: "shared-api-credential" | "database-seed-operator" = "shared-api-credential") {}
  async list(entity: Entity, options: { q: string; limit: number; offset: number }) {
    return transaction(this.pool, async client => {
      const revision = await currentRevision(client);
      const condition = "strpos(lower(row_to_json(t)::text), lower($1)) > 0";
      const count = await client.query(`SELECT count(*)::integer AS total FROM ${schema}.${entity} t WHERE ${condition}`, [options.q]);
      const rows = await client.query(`SELECT t.* FROM ${schema}.${entity} t WHERE ${condition} ORDER BY id LIMIT $2 OFFSET $3`, [options.q, options.limit, options.offset]);
      return { revision, total: count.rows[0].total as number, limit: options.limit, offset: options.offset, items: rows.rows.map(jsonRow) };
    }, true);
  }
  async history(entity: Entity, id: string, limit: number, offset: number) {
    return transaction(this.pool, async client => {
      const revision = await currentRevision(client);
      const total = await client.query(`SELECT count(*)::integer AS total FROM ${schema}.changes WHERE entity=$1 AND record_id=$2`, [entity, id]);
      const rows = await client.query(`SELECT * FROM ${schema}.changes WHERE entity=$1 AND record_id=$2 ORDER BY revision DESC LIMIT $3 OFFSET $4`, [entity, id, limit, offset]);
      return { revision, total: total.rows[0].total as number, limit, offset, items: rows.rows.map(jsonRow) };
    }, true);
  }
  async report(name: "coverage" | "dependency_map", limit: number, offset: number) {
    return transaction(this.pool, async client => {
      const revision = await currentRevision(client);
      const order = name === "coverage" ? "application_id, standard_id" : "id";
      const total = await client.query(`SELECT count(*)::integer AS total FROM ${schema}.${name}`);
      const rows = await client.query(`SELECT * FROM ${schema}.${name} ORDER BY ${order} LIMIT $1 OFFSET $2`, [limit, offset]);
      return { revision, total: total.rows[0].total as number, limit, offset, items: rows.rows.map(jsonRow) };
    }, true);
  }
  async save(entity: Entity, input: unknown, expectedRevision: number) {
    const request = record(input, "update");
    if (Object.keys(request).length !== 2 || !Object.hasOwn(request, "record") || !Object.hasOwn(request, "changeNote")) throw new ApiError(400, "INVALID_ARCHITECTURE", "Envie record e changeNote.");
    const value = parseRecord(entity, request.record), note = changeNote(request.changeNote);
    try {
      return await transaction(this.pool, async client => {
        const revision = await currentRevision(client, true);
        if (revision !== expectedRevision) throw new ApiError(412, "REVISION_CONFLICT", "O catálogo mudou. Recarregue antes de salvar.");
        const previous = await client.query(`SELECT * FROM ${schema}.${entity} WHERE id=$1`, [value.id]);
        if (previous.rowCount && IMMUTABLE.has(entity)) throw new ApiError(409, "IMMUTABLE_RECORD", "Evidências, avaliações e publicações são registros imutáveis; cadastre uma nova observação.");
        if (previous.rowCount && "applicationId" in value && previous.rows[0].application_id !== value.applicationId) throw new ApiError(409, "APPLICATION_IMMUTABLE", "A aplicação de um registro não pode ser alterada.");
        if (entity === "assessments") {
          const standard = await client.query(`SELECT application_id,version,status FROM ${schema}.standards WHERE id=$1`, [value.standardId]);
          const rule = standard.rows[0];
          if (!rule || rule.version !== value.standardVersion || rule.status === "retired" || (rule.application_id !== null && rule.application_id !== value.applicationId)) throw new ApiError(400, "INVALID_ASSESSMENT", "A avaliação exige a versão atual de um padrão aplicável.");
        }
        if (entity === "deployments") {
          const evidence = await client.query(`SELECT kind,source_commit FROM ${schema}.evidence WHERE id=$1 AND application_id=$2`, [value.evidenceId, value.applicationId]);
          if (evidence.rows[0]?.kind !== "deployment" || evidence.rows[0]?.source_commit !== value.sourceCommit) throw new ApiError(400, "INVALID_DEPLOYMENT", "A publicação exige evidência de deployment do mesmo commit e aplicação.");
        }
        const columns = Object.keys(ENTITIES[entity]);
        const values = [value.id, ...columns.map(column => value[property(column)])];
        const version = previous.rowCount ? previous.rows[0].version + 1 : 1;
        const allColumns = ["id", ...columns, "version"];
        const conflict = IMMUTABLE.has(entity) ? "" : `ON CONFLICT (id) DO UPDATE SET ${columns.map(column => `${column}=EXCLUDED.${column}`).join(",")},version=EXCLUDED.version,updated_at=clock_timestamp()`;
        const result = await client.query(`INSERT INTO ${schema}.${entity} (${allColumns.join(",")}) VALUES (${allColumns.map((_, index) => `$${index + 1}`).join(",")}) ${conflict} RETURNING *`, [...values, version]);
        const saved = jsonRow(result.rows[0]);
        const updated = await client.query(`UPDATE ${schema}.catalog_revision SET revision=revision+1 RETURNING revision`);
        const next = updated.rows[0].revision as number;
        await client.query(`INSERT INTO ${schema}.changes(revision,entity,record_id,change_note,snapshot,actor) VALUES ($1,$2,$3,$4,$5,$6)`, [next, entity, value.id, note, JSON.stringify(saved), this.actor]);
        return { revision: next, record: saved };
      });
    } catch (error) { return databaseError(error); }
  }
}
