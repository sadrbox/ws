// Разовая диагностика: какие агенты есть и кто обслуживает базу.
import pg from "pg";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const agents = await db.query(
  `SELECT id, name, role, status, version, server_id,
          (capabilities @> '["ib.admin"]'::jsonb) AS ib_admin,
          last_seen_at
     FROM agents ORDER BY last_seen_at DESC NULLS LAST`);
console.log("АГЕНТЫ:");
for (const a of agents.rows) {
  console.log(`  ${a.id.slice(0,8)} role=${a.role} status=${a.status} version=${a.version} server=${a.server_id} ib.admin=${a.ib_admin} last_seen=${a.last_seen_at?.toISOString?.() ?? a.last_seen_at}`);
}
const bases = await db.query(
  `SELECT key, server_id FROM bases WHERE key = ANY($1) AND disabled_at IS NULL`,
  [["anel", "aibek", "abdali", "adinurtoo", "_transition"]]);
console.log("БАЗЫ:");
for (const b of bases.rows) console.log(`  ${b.key} -> server ${b.server_id}`);
await db.end();
