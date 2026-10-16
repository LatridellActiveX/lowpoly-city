/**
 * ui/trafficPanel.ts — OASIS: Inspect panels for the ROAD GRAPH traffic
 * (junctions, road edges, cars) and the "Show stuck cars" pill.
 *
 * Only builds HTML strings from the pure records in sim/trafficInspect.ts;
 * hud.ts drops them into the existing .info panel so they look like every
 * other Inspect panel (h3 title + .row lines, .muted / .bad colours).
 *
 * COPYABLE IDS: every id is a <code class="cid">node 42</code>. It is
 * user-selectable text AND a click copies it to the clipboard (hud.ts wires
 * the click), so Parker can paste "node 42" / "edge 17" / "car 311" into a
 * message.
 *
 * Numbers go through ui/format.ts formatAmount (metres, speeds, counts) so
 * they never print float leftovers. Seconds use secs() (one decimal < 10 s).
 */
import { ROAD_SPEC } from '../roads/graph';
import { EdgeInfo, NodeInfo, roadLabel, STUCK_SECONDS, VehicleInfo } from '../sim/trafficInspect';
import { formatAmount } from './format';

/** Copyable id chip. */
export const cid = (kind: 'node' | 'edge' | 'car', id: number): string => `<code class="cid" title="Click to copy">${kind} ${id}</code>`;
/** Seconds for the panel: "4.5 s", "12 s". */
export const secs = (s: number): string => `${formatAmount(s)} s`;
/** m/s → km/h, the unit players think in. */
const kmh = (ms: number): string => `${formatAmount(ms * 3.6)} km/h`;
const turnIcon = { left: '↰', straight: '↑', right: '↱' } as const;

/** Junction (graph node) panel: [title, rows]. */
export function nodePanel(n: NodeInfo): [string, string[]] {
  const rows: string[] = [];
  const ctl = n.control === 'plain' ? 'no signal (first come)' : n.control === 'stop' ? 'stop signs' : n.control === 'signal' ? 'traffic lights' : 'roundabout (ring has priority)';
  rows.push(`<div class="row">${cid('node', n.id)} · <b>${n.shape}</b> · ${ctl}</div>`);
  // Connected edges: "edge 17 → node 9 · avenue · in 2 / out 2"
  rows.push('<div class="row levelbars-h">Roads</div>');
  for (const r of n.edges) rows.push(`<div class="row tight">${cid('edge', r.edge)} → ${cid('node', r.other)} · ${roadLabel(r.type)} · lanes in <b>${r.lanesIn}</b> / out <b>${r.lanesOut}</b></div>`);
  // Signal
  if (n.signal) {
    const s = n.signal;
    rows.push(`<div class="row">🚦 Phase ${s.phase + 1}/${s.phases}: ${s.state === 'green' ? `<span class="ok">green</span> for ${cid('edge', s.greenEdge)}` : '<b>all red</b> (clearing)'} · ${secs(s.remaining)} left</div>`);
  }
  // Lane connections, grouped per incoming lane: "edge 17 L0 → ↰ e5 L0 · ↑ e8 L0"
  if (n.conns.length) {
    rows.push('<div class="row levelbars-h">Lane connections</div>');
    const by = new Map<string, string[]>();
    for (const c of n.conns) {
      const k = `${c.inEdge}:${c.inLane}`;
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(`${turnIcon[c.turn]} e${c.outEdge} L${c.outLane}`);
    }
    for (const [k, outs] of by) { const [e, l] = k.split(':'); rows.push(`<div class="row tight mono">e${e} L${l} → ${outs.join(' · ')}</div>`); }
  }
  if (n.missing.length) {
    rows.push(`<div class="row bad">⚠ Missing connections (${n.missing.length}):</div>`);
    for (const m of n.missing) rows.push(m.kind === 'turn'
      ? `<div class="row tight bad">no turn ${cid('edge', m.inEdge)} → ${cid('edge', m.outEdge)}</div>`
      : `<div class="row tight bad">lane ${m.inLane} of ${cid('edge', m.inEdge)} has no exit</div>`);
  } else if (n.edges.length >= 2) rows.push('<div class="row muted">All approaches connect.</div>');
  // Queues
  const q = n.queues.filter((r) => r.queued > 0);
  rows.push('<div class="row levelbars-h">Traffic</div>');
  rows.push(`<div class="row">Queued: ${q.length ? q.map((r) => `${cid('edge', r.edge)} <b>${r.queued}</b>`).join(' · ') : 'none'}${n.inBox ? ` · in junction <b>${n.inBox}</b>` : ''}</div>`);
  rows.push(`<div class="row">Longest wait: <b class="${n.longestWait > STUCK_SECONDS ? 'bad' : ''}">${secs(n.longestWait)}</b>${n.stuck ? ` · <span class="bad">${n.stuck} stuck</span>` : ''}</div>`);
  return [`Junction ${n.id}`, rows];
}

/** Road edge panel. */
export function edgePanel(e: EdgeInfo): [string, string[]] {
  const rows: string[] = [];
  rows.push(`<div class="row">${cid('edge', e.id)} · ${cid('node', e.from)} → ${cid('node', e.to)}</div>`);
  rows.push(`<div class="row"><b>${e.label}</b> · ${formatAmount(e.length)} m · lanes ${e.lanesBA ? `<b>${e.lanesAB}</b> each way` : `<b>${e.lanesAB}</b> one way`} · limit ${kmh(ROAD_SPEC[e.type].speed)}</div>`);
  rows.push(`<div class="row">Vehicles: <b>${e.vehicles}</b> · avg speed ${kmh(e.avgSpeed)}</div>`);
  rows.push(`<div class="row">Stuck (still > ${STUCK_SECONDS} s): <b class="${e.stuck ? 'bad' : ''}">${e.stuck}</b></div>`);
  return [`${e.label[0].toUpperCase()}${e.label.slice(1)} ${e.id}`, rows];
}

/** Vehicle panel. */
export function vehiclePanel(v: VehicleInfo): [string, string[]] {
  const rows: string[] = [];
  rows.push(`<div class="row">${cid('car', v.id)} · ${v.kind} · trip <b>${v.trip}</b></div>`);
  rows.push(`<div class="row">${v.edge >= 0 ? `On ${cid('edge', v.edge)} lane ${v.lane}` : `In junction ${cid('node', v.inJunction)}`}${v.nextNode >= 0 ? ` · next ${cid('node', v.nextNode)}` : ' · parks on this road'}</div>`);
  rows.push(`<div class="row">Route left: <b>${v.edgesLeft}</b> road${v.edgesLeft === 1 ? '' : 's'} · ${formatAmount(v.metresLeft)} m</div>`);
  rows.push(`<div class="row">Speed ${kmh(v.speed)} · waiting <b class="${v.stuck ? 'bad' : ''}">${secs(v.wait)}</b></div>`);
  rows.push(v.stuck ? `<div class="row bad">STUCK${v.blockedAt >= 0 ? ` at ${cid('node', v.blockedAt)}` : ''} — gives up after 90 s</div>` : '<div class="row ok">Moving / not stuck</div>');
  return [`Car ${v.id}`, rows];
}

/** Text of the stuck-car pill. */
export const stuckPill = (on: boolean, cars: number, nodes: number): string =>
  `🚨 ${on ? 'Hide' : 'Show'} stuck cars <b class="${cars ? 'bad' : ''}">${cars}</b>${on && nodes ? ` · ${nodes} junction${nodes === 1 ? '' : 's'}` : ''}`;
