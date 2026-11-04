import { architecturePool, migrateArchitecture } from "./database.js";
import { importSources, previewSources } from "./import.js";
import { revisionHeader } from "./schema.js";
import { ArchitectureStore } from "./store.js";
import { ROUTE_PRODUCTS } from "../policy-contracts.js";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "preview" && args.length === 1) {
    const { snapshots: _, ...preview } = await previewSources(args[0]!);
    console.log(JSON.stringify(preview, null, 2));
    return;
  }
  if (!((command === "migrate" || command === "status" || command === "seed-applications") && args.length === 0)
      && !(command === "import" && args.length === 4)) throw new Error("Usage: architecture:db migrate | status | seed-applications | preview <data-dir> | import <data-dir> <preview-sha256> <revision> <change-note>");
  const url = process.env.LAB_ARCHITECTURE_ADMIN_DATABASE_URL;
  if (!url) throw new Error("LAB_ARCHITECTURE_ADMIN_DATABASE_URL is required");
  const pool = architecturePool(url);
  try {
    if (command === "migrate") {
      await migrateArchitecture(pool);
      console.log("Architecture migration verified and applied.");
    } else if (command === "status") {
      const state = await pool.query("SELECT revision, (SELECT max(version) FROM experiments_architecture.schema_migrations) AS migration FROM experiments_architecture.catalog_revision WHERE singleton");
      console.log(JSON.stringify(state.rows[0]));
    } else if (command === "seed-applications") {
      const store = new ArchitectureStore(pool, "database-seed-operator");
      let created = 0;
      for (const product of ROUTE_PRODUCTS) {
        const current = await pool.query("SELECT id FROM experiments_architecture.applications WHERE id=$1", [product.id]);
        if (current.rowCount) continue;
        const state = await pool.query("SELECT revision FROM experiments_architecture.catalog_revision WHERE singleton");
        await store.save("applications", { record: { ...product, description: "Aplicação do inventário de produtos do Experiments; arquitetura pendente de levantamento.", owner: null, lifecycle: "unknown", repository: null }, changeNote: "Cadastro inicial a partir de ROUTE_PRODUCTS; não atesta implementação ou publicação." }, state.rows[0].revision as number);
        created++;
      }
      console.log(JSON.stringify({ created }));
    } else {
      const revision = revisionHeader(`"${args[2]}"`);
      console.log(JSON.stringify(await importSources(pool, args[0]!, args[1]!, revision, args[3]!)));
    }
  } finally { await pool.end(); }
}
void main().catch(() => {
  // Database errors may contain credentials, SQL values, or private source content.
  console.error("Architecture command failed. Check arguments, database access, migration and preview revision. See docs/ARCHITECTURE-DATABASE.md.");
  process.exitCode = 1;
});
