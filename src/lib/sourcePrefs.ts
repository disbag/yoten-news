import { pool } from "./db.js";
import { SOURCE_GROUPS, OTHER_SOURCES_LABEL } from "../config/sourceGroups.js";

export type SettingsSource = { id: number; name: string; enabled: boolean };
export type SettingsGroup = { label: string; sources: SettingsSource[] };

// Все издания, разложенные по группам страницы настроек (см.
// SOURCE_GROUPS), с текущим состоянием переключателя для пользователя.
//
// У издания может быть несколько фидов — несколько строк sources с одним
// названием (см. extraFeeds в src/config/sources.ts). В настройках это один
// переключатель: id — любой из его фидов, выключено — если выключен хоть один.
export async function getSettingsGroups(userId: number): Promise<SettingsGroup[]> {
  const { rows } = await pool.query<{ id: number; name: string; hidden: boolean }>(
    `SELECT min(s.id) AS id, s.name, bool_or(h.user_id IS NOT NULL) AS hidden
     FROM sources s
     LEFT JOIN user_hidden_sources h ON h.source_id = s.id AND h.user_id = $1
     GROUP BY s.name
     ORDER BY s.name`,
    [userId]
  );
  const byName = new Map(rows.map((r) => [r.name, { id: r.id, name: r.name, enabled: !r.hidden }]));

  const groups: SettingsGroup[] = SOURCE_GROUPS.map((group) => ({
    label: group.label,
    sources: group.sources.flatMap((name) => {
      const source = byName.get(name);
      if (!source) return [];
      byName.delete(name);
      return [source];
    }),
  })).filter((group) => group.sources.length > 0);

  if (byName.size > 0) groups.push({ label: OTHER_SOURCES_LABEL, sources: [...byName.values()] });
  return groups;
}

// Переключает издание целиком — все его фиды (строки sources с тем же
// названием, что у sourceId). false — такого издания нет (id из запроса не
// нашёлся в sources).
export async function setSourceEnabled(userId: number, sourceId: number, enabled: boolean): Promise<boolean> {
  const exists = await pool.query("SELECT 1 FROM sources WHERE id = $1", [sourceId]);
  if (!exists.rowCount) return false;
  if (enabled) {
    await pool.query(
      `DELETE FROM user_hidden_sources
       WHERE user_id = $1
         AND source_id IN (SELECT id FROM sources WHERE name = (SELECT name FROM sources WHERE id = $2))`,
      [userId, sourceId]
    );
  } else {
    await pool.query(
      `INSERT INTO user_hidden_sources (user_id, source_id)
       SELECT $1, id FROM sources WHERE name = (SELECT name FROM sources WHERE id = $2)
       ON CONFLICT DO NOTHING`,
      [userId, sourceId]
    );
  }
  return true;
}
