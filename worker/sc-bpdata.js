// Crafting blueprints from the game's own database, read by the OmniGlass Desktop extractor
// (`node tools/extract/run.mjs site-blueprints`, copied to worker/sc-blueprints-game.json). Same shapes as sc-blueprints.js
// serves from the wiki, so the Blueprints pane and the Fabricator planner read either. Nothing is fetched at request time.
import data from './sc-blueprints-game.json' with { type: 'json' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const hasGameBlueprints = () => Array.isArray(data?.list) && data.list.length > 0 && !!data.detail && typeof data.detail === 'object';

export const handleGameList = () => ({ status: 200, body: { ready: true, complete: true, source: 'game', version: String(data.build || '').slice(0, 40), blueprints: data.list } });

export function handleGameOne(url) {
  const id = String(url.searchParams.get('id') || '').toLowerCase();
  if (!UUID.test(id)) return { status: 400, body: { ready: false, error: 'bad_id' } };
  const d = Object.hasOwn(data.detail || {}, id) ? data.detail[id] : null;
  return d ? { status: 200, body: { ready: true, blueprint: d } } : { status: 404, body: { ready: false, error: 'unknown_blueprint' } };
}
