// Set-Ansicht mit drei Zielen pro Set:
//   Karten       – jede Karte des Sets einmal (egal welche Variante)
//   Reverse Holo – jede Karte, die es als Reverse Holo gibt, als Reverse Holo
//   Master Set   – jede Karte in ALLEN Varianten, die es für sie gibt (Normal, Reverse, Holo, 1st Edition)
//
// Einbau in App.jsx:
//   1. die alte `function SetsView(...)` samt `setIdOf` aus App.jsx löschen
//   2. import { SetsView } from './SetsMaster';
//   3. <SetsView collection={collection} watchIds={watchlistIds} api={API_URL} uid={auth.currentUser?.uid} Img={CardImage} />
//
// Die Variantendaten liefert TCGdex pro Karte (card.variants). Für Karten in deiner Collection sind sie
// schon gespeichert; für fehlende Karten werden sie beim Öffnen eines Sets über /api/cards/bulk nachgeladen.
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { CompletionPanel } from './Completion';

const VARIANTS = [
  { key: 'normal', label: 'Normal' },
  { key: 'reverse', label: 'Reverse Holo' },
  { key: 'holo', label: 'Holo' },
  { key: 'firstEdition', label: '1st Edition' }
];
const VLABEL = Object.fromEntries(VARIANTS.map((v) => [v.key, v.label]));

const MODES = [
  ['cards', 'Karten', 'Jede Karte einmal, egal in welcher Variante.'],
  ['reverse', 'Reverse Holo', 'Jede Karte, die es als Reverse Holo gibt, als Reverse Holo.'],
  ['master', 'Master Set', 'Jede Karte in allen Varianten, die es für sie gibt.']
];

const setIdOf = (item) => {
  if (item?.set?.id) return item.set.id;
  const id = String(item?.id || '');
  if (!id || id.startsWith('custom-') || id.startsWith('cm-')) return null;
  const i = id.lastIndexOf('-');
  return i > 0 ? id.slice(0, i) : null;
};

// Welche Varianten gibt es für diese Karte? (Flags von TCGdex; ohne Angabe: nur Normal)
const variantKeys = (flags) => {
  if (!flags) return ['normal'];
  const keys = VARIANTS.filter((v) => flags[v.key]).map((v) => v.key);
  return keys.length ? keys : ['normal'];
};

const pctOf = (done, total) => (total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0);

function Bar({ done, total, tone = 'cyan' }) {
  const color = tone === 'violet' ? 'bg-violet-400' : tone === 'amber' ? 'bg-amber-400' : 'bg-cyan-500';
  return (
    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pctOf(done, total)}%` }} />
    </div>
  );
}

export function SetsView({ collection, watchIds, api, uid, Img }) {
  const [mode, setMode] = useState('cards');
  const [open, setOpen] = useState(null);
  const [cache, setCache] = useState({});   // setId -> { loading } | { cards } | { error }
  const [vcache, setVcache] = useState({}); // setId -> { loading, progress } | { map } | { error }
  const [noSecret, setNoSecret] = useState({});
  const inflight = useRef(new Set());

  // ---- Besitz aus der Collection: Karte -> besessene Varianten, plus bekannte Variantenflags ----
  const { groups, withoutSet, ownedV, knownFlags } = useMemo(() => {
    const g = new Map();
    const ov = new Map();
    const kf = new Map();
    let none = 0;
    collection.forEach((item) => {
      const sid = setIdOf(item);
      if (!sid) { none += 1; return; }
      const e = g.get(sid) || { id: sid, name: item.set?.name || sid, total: item.set?.total || null, ids: new Set() };
      e.ids.add(item.id);
      g.set(sid, e);
      const set = ov.get(item.id) || new Set();
      set.add(item.userVariant || 'normal');
      ov.set(item.id, set);
      if (item.variants && !kf.has(item.id)) kf.set(item.id, item.variants);
    });
    return { groups: [...g.values()], withoutSet: none, ownedV: ov, knownFlags: kf };
  }, [collection]);

  // ---- Kartenliste eines Sets laden ----
  const loadCards = async (g) => {
    if (cache[g.id]?.cards) return cache[g.id].cards;
    setCache((c) => ({ ...c, [g.id]: { loading: true } }));
    try {
      const res = await fetch(`${api}/api/sets/${encodeURIComponent(g.id)}`);
      if (!res.ok) throw new Error('Set nicht gefunden');
      const data = await res.json();
      const cards = data.cards || [];
      setCache((c) => ({ ...c, [g.id]: { cards } }));
      return cards;
    } catch (e) {
      setCache((c) => ({ ...c, [g.id]: { error: e.message || 'Fehler beim Laden' } }));
      return null;
    }
  };

  // ---- Varianten aller Karten eines Sets laden (nur für Karten ohne bekannte Flags) ----
  const loadVariants = async (g, cards) => {
    if (vcache[g.id]?.map || inflight.current.has(g.id)) return;
    inflight.current.add(g.id);
    const map = {};
    const need = [];
    cards.forEach((c) => {
      if (knownFlags.has(c.id)) map[c.id] = variantKeys(knownFlags.get(c.id));
      else need.push(c.id);
    });
    setVcache((v) => ({ ...v, [g.id]: { loading: true, progress: `0 / ${need.length}` } }));
    try {
      for (let i = 0; i < need.length; i += 40) {
        const part = need.slice(i, i + 40);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120000);
        const res = await fetch(`${api}/api/cards/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ ids: part })
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`Server antwortet mit Status ${res.status}`);
        ((await res.json()).cards || []).forEach((card) => { map[card.id] = variantKeys(card.variants); });
        setVcache((v) => ({ ...v, [g.id]: { loading: true, progress: `${Math.min(i + 40, need.length)} / ${need.length}` } }));
      }
      // Karten, die der Server nicht geliefert hat, zählen vorsichtig nur als „Normal“
      cards.forEach((c) => { if (!map[c.id]) map[c.id] = ['normal']; });
      setVcache((v) => ({ ...v, [g.id]: { map } }));
    } catch (e) {
      setVcache((v) => ({
        ...v,
        [g.id]: { error: e.name === 'AbortError' ? 'Der Server hat zu lange nicht geantwortet (Render schläft evtl.). Bitte gleich nochmal versuchen.' : (e.message || 'Varianten konnten nicht geladen werden') }
      }));
    } finally {
      inflight.current.delete(g.id);
    }
  };

  const needVariants = mode !== 'cards';

  // Offenes Set: bei Reverse-/Master-Modus Varianten automatisch nachladen
  useEffect(() => {
    if (!open || !needVariants) return;
    const g = groups.find((x) => x.id === open);
    const cards = cache[open]?.cards;
    const v = vcache[open];
    if (g && cards && !v) loadVariants(g, cards);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, needVariants, cache, vcache]);

  const toggle = async (g) => {
    if (open === g.id) { setOpen(null); return; }
    setOpen(g.id);
    await loadCards(g);
  };

  // ---- Fortschritt eines Sets für den aktuellen Modus ----
  const progressOf = (g) => {
    const cards = cache[g.id]?.cards;
    const vmap = vcache[g.id]?.map;
    const hide = !!noSecret[g.id];
    const isSecret = (c) => !!g.total && /^\d+$/.test(String(c.localId)) && parseInt(c.localId, 10) > g.total;
    const list = cards ? (hide ? cards.filter((c) => !isSecret(c)) : cards) : null;

    const base = { owned: g.ids.size, total: g.total || 0, ready: true };
    if (!list) return { cards: base, reverse: null, master: null, list: null, hide };

    const baseOwned = list.filter((c) => g.ids.has(c.id)).length;
    const cardsP = { owned: baseOwned, total: list.length, ready: true };
    if (!vmap) return { cards: cardsP, reverse: null, master: null, list, hide };

    let revT = 0; let revO = 0; let masT = 0; let masO = 0;
    const missRev = []; const missMaster = [];
    list.forEach((c) => {
      const keys = vmap[c.id] || ['normal'];
      const have = ownedV.get(c.id) || new Set();
      if (keys.includes('reverse')) {
        revT += 1;
        if (have.has('reverse')) revO += 1; else missRev.push({ card: c, variants: ['reverse'] });
      }
      masT += keys.length;
      const lacking = keys.filter((k) => !have.has(k));
      masO += keys.length - lacking.length;
      if (lacking.length) missMaster.push({ card: c, variants: lacking });
    });
    return {
      cards: cardsP,
      reverse: { owned: revO, total: revT, ready: true, missing: missRev },
      master: { owned: masO, total: masT, ready: true, missing: missMaster },
      list,
      hide
    };
  };

  const rows = groups.map((g) => ({ g, p: progressOf(g) }));
  rows.sort((a, b) => {
    const pa = (a.p[mode] || a.p.cards); const pb = (b.p[mode] || b.p.cards);
    const fa = pa.total ? pa.owned / pa.total : 0; const fb = pb.total ? pb.owned / pb.total : 0;
    return fb - fa || a.g.name.localeCompare(b.g.name);
  });

  if (groups.length === 0) {
    return <div className="text-center py-20 text-slate-500">Noch keine Karten mit Set-Zuordnung in deiner Collection.</div>;
  }

  const modeHint = MODES.find((m) => m[0] === mode)[2];

  return (
    <div className="space-y-3">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
        <div className="flex gap-1.5">
          {MODES.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setMode(k)}
              className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${mode === k ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'}`}
            >{label}</button>
          ))}
        </div>
        <p className="text-[10px] text-slate-500">
          {modeHint}{needVariants ? ' Die Varianten fehlender Karten werden beim Öffnen eines Sets geladen.' : ''}
        </p>
      </div>

      {rows.map(({ g, p }) => {
        const shown = p[mode];
        const isOpen = open === g.id;
        const c = cache[g.id];
        const v = vcache[g.id];
        const tone = mode === 'reverse' ? 'violet' : mode === 'master' ? 'amber' : 'cyan';
        return (
          <div key={g.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 shadow-md">
            <button onClick={() => toggle(g)} className="w-full text-left">
              <div className="flex justify-between items-baseline gap-2">
                <span className="font-bold text-sm text-slate-200 truncate">{g.name}</span>
                {shown ? (
                  <span className="text-xs text-cyan-400 font-bold whitespace-nowrap">
                    {shown.owned}{shown.total ? ` / ${shown.total}` : ''}{shown.total ? ` (${pctOf(shown.owned, shown.total)}%)` : ''}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-500 whitespace-nowrap">öffnen für Berechnung</span>
                )}
              </div>
              <div className="mt-2"><Bar done={shown ? shown.owned : 0} total={shown ? shown.total : 0} tone={tone} /></div>
            </button>

            {isOpen && (
              <div className="mt-3 pt-3 border-t border-slate-800 space-y-3">
                {c?.loading && <p className="text-xs text-cyan-400">Lade Kartenliste…</p>}
                {c?.error && <p className="text-xs text-rose-400">{c.error}</p>}

                {c?.cards && (
                  <>
                    {/* Überblick über alle drei Ziele */}
                    <div className="space-y-2">
                      {[['cards', 'Karten', 'cyan'], ['reverse', 'Reverse Holo', 'violet'], ['master', 'Master Set', 'amber']].map(([k, label, t]) => {
                        const pp = p[k];
                        return (
                          <div key={k} className={`rounded-lg p-2 border ${mode === k ? 'border-slate-600 bg-slate-950' : 'border-transparent'}`}>
                            <div className="flex justify-between text-[11px] mb-1">
                              <span className="text-slate-300 font-bold">{label}</span>
                              <span className="text-slate-400">
                                {pp ? `${pp.owned} / ${pp.total} (${pctOf(pp.owned, pp.total)}%)` : (v?.loading ? `lädt ${v.progress || ''}` : '–')}
                              </span>
                            </div>
                            <Bar done={pp ? pp.owned : 0} total={pp ? pp.total : 0} tone={t} />
                          </div>
                        );
                      })}
                    </div>

                    {needVariants && v?.error && (
                      <div className="space-y-1">
                        <p className="text-xs text-rose-400">{v.error}</p>
                        <button
                          onClick={() => { setVcache((x) => { const n = { ...x }; delete n[g.id]; return n; }); }}
                          className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950"
                        >Erneut versuchen</button>
                      </div>
                    )}
                    {needVariants && v?.loading && <p className="text-xs text-cyan-400">Lade Varianten … {v.progress}</p>}

                    {g.total ? (
                      <label className="flex items-center gap-2 text-[11px] text-slate-400">
                        <input
                          type="checkbox"
                          checked={p.hide}
                          onChange={(e) => setNoSecret((s) => ({ ...s, [g.id]: e.target.checked }))}
                          className="accent-cyan-500"
                        />
                        Secret Rares (Nr. über {g.total}) nicht mitrechnen
                      </label>
                    ) : null}

                    {/* Modus Karten: fehlende Karten + Kosten */}
                    {mode === 'cards' && p.list && (() => {
                      const missing = p.list.filter((card) => !g.ids.has(card.id));
                      if (missing.length === 0) return <p className="text-xs text-emerald-400">Komplett – dir fehlt keine Karte dieses Sets. 🎉</p>;
                      return (
                        <>
                          <p className="text-[10px] text-slate-500">Fehlend: {missing.length}</p>
                          <CompletionPanel
                            title="💶 Was kostet es, dieses Set zu komplettieren?"
                            cards={missing.map((card) => ({ id: card.id, name: card.name, image: card.image, localId: card.localId, setName: g.name }))}
                            api={api}
                            uid={uid}
                            watchIds={watchIds}
                            Img={Img}
                          />
                          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                            {missing.map((card) => (
                              <div key={card.id} className="text-center">
                                <Img src={card.image} alt={card.name} className="w-full rounded-md opacity-70" />
                                <p className="text-[10px] text-slate-400 mt-1 truncate">#{card.localId} {card.name}</p>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}

                    {/* Modus Reverse / Master: fehlende Karten mit den fehlenden Varianten */}
                    {mode !== 'cards' && p[mode] && (() => {
                      const missing = p[mode].missing;
                      if (missing.length === 0) {
                        return (
                          <p className="text-xs text-emerald-400">
                            {mode === 'reverse' ? 'Alle Reverse Holos dieses Sets sind da. 🎉' : 'Master Set komplett – alle Varianten sind da. 🎉'}
                          </p>
                        );
                      }
                      return (
                        <>
                          <p className="text-[10px] text-slate-500">
                            Fehlend: {mode === 'reverse' ? `${missing.length} Reverse Holos` : `${p.master.total - p.master.owned} Varianten bei ${missing.length} Karten`}
                          </p>
                          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                            {missing.map(({ card, variants }) => {
                              const hasAny = g.ids.has(card.id);
                              return (
                                <div key={card.id} className="text-center">
                                  <div className="relative">
                                    <Img src={card.image} alt={card.name} className={`w-full rounded-md ${hasAny ? '' : 'opacity-60'}`} />
                                    {hasAny && <span className="absolute top-1 right-1 bg-emerald-500 text-slate-950 text-[9px] font-black rounded-full px-1.5" title="Mindestens eine Variante vorhanden">✓</span>}
                                  </div>
                                  <p className="text-[10px] text-slate-400 mt-1 truncate">#{card.localId} {card.name}</p>
                                  <div className="flex flex-wrap justify-center gap-0.5 mt-0.5">
                                    {variants.map((k) => (
                                      <span key={k} className="text-[8px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-1">{VLABEL[k] || k}</span>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <p className="text-[10px] text-slate-500">Das ✓ zeigt, dass du die Karte in einer anderen Variante schon hast.</p>
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {withoutSet > 0 && <p className="text-[10px] text-slate-500 text-center">{withoutSet} Karten ohne Set-Zuordnung sind hier nicht enthalten.</p>}
    </div>
  );
}

export default SetsView;
