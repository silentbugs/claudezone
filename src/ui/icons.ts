/** Inline SVG icons for the HUD (currentColor where it makes sense). */
const s = (body: string, vb = '0 0 24 24') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

export const ICON: Record<string, string> = {
  lock: s('<rect x="5" y="10" width="14" height="11" rx="1.5" fill="currentColor"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.2"/>'),
  // blueprint marker: drafting compass
  blueprint: s('<circle cx="12" cy="4" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M11 6L5 21M13 6l6 15M7.5 15h9" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'),
  // armor plate: rectangle with both top corners chamfered ("shooter's cut"), stitched border
  plate: s('<path d="M6 2h12l3 4v15.5c0 .8-.7 1.5-1.5 1.5h-15c-.8 0-1.5-.7-1.5-1.5V6z" fill="#b9bcbf" stroke="#6d7074" stroke-width="1"/><path d="M7 4h10l2 2.8V20H5V6.8z" fill="none" stroke="#8d9094" stroke-width=".7" stroke-dasharray="1.2 .8"/><rect x="8" y="13" width="8" height="4" rx=".6" fill="#8a8e92"/><text x="12" y="10" font-size="3.4" text-anchor="middle" fill="#6d7074" font-family="sans-serif" font-weight="700">TOP</text>'),
  satchel: s('<path d="M6 6c0-2 2-4 6-4s6 2 6 4v14c0 1-1 2-2 2H8c-1 0-2-1-2-2z" fill="#9ea2a5" stroke="#5f6366"/><rect x="8" y="11" width="8" height="7" rx="1" fill="#7f8387" stroke="#5f6366"/><path d="M9 4h6" stroke="#5f6366" stroke-width="1.5"/>'),
  cash: s('<text x="12" y="19" font-size="20" text-anchor="middle" font-family="sans-serif" font-weight="800" fill="url(#g)">$</text><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#9aa0a6"/></linearGradient></defs>'),
  selfRevive: s('<circle cx="12" cy="12" r="10" fill="none" stroke="#fff" stroke-width="2"/><path d="M12 6v12M6 12h12" stroke="#fff" stroke-width="2.4"/>'),
  gasMask: s('<path d="M5 8c0-3 3-5 7-5s7 2 7 5v4c0 5-3 9-7 9s-7-4-7-9z" fill="#8e9296" stroke="#55595c"/><circle cx="9" cy="10" r="2.4" fill="#2a2d30"/><circle cx="15" cy="10" r="2.4" fill="#2a2d30"/><circle cx="12" cy="17" r="2.6" fill="#55595c"/><rect x="18" y="14" width="4" height="5" rx="1" fill="#6d7174"/>'),
  skull: s('<path d="M12 2C7 2 4 5.5 4 10c0 2.6 1.2 4.4 3 5.4V19c0 .6.4 1 1 1h1v-2h2v2h2v-2h2v2h1c.6 0 1-.4 1-1v-3.6c1.8-1 3-2.8 3-5.4 0-4.5-3-8-8-8z" fill="#fff"/><circle cx="8.6" cy="10.5" r="2.1" fill="#111"/><circle cx="15.4" cy="10.5" r="2.1" fill="#111"/><path d="M12 13l-1.2 2.2h2.4z" fill="#111"/>'),
  squads: s('<circle cx="7" cy="8" r="2.6" fill="#fff"/><circle cx="17" cy="8" r="2.6" fill="#fff"/><circle cx="12" cy="6.5" r="3" fill="#fff"/><path d="M2 20c0-4 2-6.5 5-6.5 1.4 0 2.5.4 3.3 1.2C8.6 16 8 18 8 20zM22 20c0-4-2-6.5-5-6.5-1.4 0-2.5.4-3.3 1.2 1.7 1.3 2.3 3.3 2.3 5.3zM7 21c0-4.5 2.2-7.5 5-7.5s5 3 5 7.5z" fill="#fff"/>'),
  player: s('<circle cx="12" cy="6.5" r="3.5" fill="#fff"/><path d="M6 21c0-6 2.5-10 6-10s6 4 6 10z" fill="#fff"/>'),
  cart: s('<path d="M2 4h3l2.4 10.5h11L21 7H7" fill="none" stroke="#f39a2a" stroke-width="2" stroke-linejoin="round"/><circle cx="9" cy="19" r="1.7" fill="#f39a2a"/><circle cx="17" cy="19" r="1.7" fill="#f39a2a"/>'),
  gasHex: s('<path d="M12 1.5l9 5.2v10.6l-9 5.2-9-5.2V6.7z" fill="#e0453a"/><path d="M12 6c-2.7 0-4.4 1.9-4.4 4.3 0 1.4.7 2.5 1.7 3v1.6h1.2v-1h.9v1h1.2v-1h.9v1h1.2v-1.6c1-.5 1.7-1.6 1.7-3C16.4 7.9 14.7 6 12 6z" fill="#fff"/>'),
  shield: s('<path d="M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5z" fill="#3d8cff" stroke="#bcd8ff" stroke-width="1"/>'),
  shieldBroken: s('<path d="M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5z" fill="#3d8cff" stroke="#e8f2ff" stroke-width="1"/><path d="M12 2.5l-1.5 5 3 2.5-2.5 4 1.5 3-1 4.5" stroke="#0b1a33" stroke-width="1.6" fill="none"/><path d="M5 9l4 1.5M19 8l-4 2.5M7 16l3-2M17 15.5l-3-1.8" stroke="#0b1a33" stroke-width="1"/>'),
  // lethals
  frag: s('<ellipse cx="12" cy="14" rx="6" ry="7" fill="#6e7a52"/><path d="M9 7h6v2H9z" fill="#3a3e36"/><path d="M14 6l4-3 1 1.5-3.5 3" fill="#9a9e96"/><path d="M8 11h8M7 14h10M8 17h8" stroke="#4f5a3a" stroke-width=".8"/>'),
  semtex: s('<rect x="6" y="5" width="12" height="15" rx="2" fill="#5a6048"/><circle cx="12" cy="9" r="2" fill="#e04a3c"/><rect x="8" y="13" width="8" height="4" fill="#3a3e36"/>'),
  knife: s('<path d="M3 20l2-2 1.5 1.5L4.5 21.5z" fill="#222"/><path d="M5.5 17.5l2 2L21 5c.5-.9-.1-1.7-1-1.2z" fill="#c8ccd0"/><path d="M4 16l4 4" stroke="#333" stroke-width="2"/>'),
  molotov: s('<path d="M10 9h4v11c0 1-1 2-2 2s-2-1-2-2z" fill="#8a5a2a"/><rect x="10.5" y="5" width="3" height="4" fill="#6a4a2a"/><path d="M12 5c-1.5-1.5-1-3 0-4 .5 1.5 2 2 1.5 3.5" fill="#f39a2a"/>'),
  c4: s('<rect x="4" y="7" width="16" height="11" rx="1" fill="#b8b09a"/><rect x="6" y="9" width="7" height="4" fill="#3a3e36"/><circle cx="16.5" cy="11" r="1.4" fill="#e04a3c"/><path d="M8 18v2M16 18v2" stroke="#666"/>'),
  claymore: s('<path d="M4 9c4-3 12-3 16 0v7c-4 2-12 2-16 0z" fill="#5a6048"/><path d="M8 18l-2 3M16 18l2 3" stroke="#444" stroke-width="1.5"/>'),
  // tacticals
  stun: s('<rect x="8" y="4" width="8" height="16" rx="2" fill="#8a8e92"/><rect x="8" y="9" width="8" height="1.5" fill="#444"/><rect x="8" y="14" width="8" height="1.5" fill="#444"/><path d="M10 2h4v2h-4z" fill="#555"/>'),
  flash: s('<rect x="8" y="4" width="8" height="16" rx="2" fill="#aeb2b6"/><circle cx="12" cy="10" r="1.2" fill="#444"/><circle cx="12" cy="15" r="1.2" fill="#444"/><path d="M10 2h4v2h-4z" fill="#555"/>'),
  smoke: s('<rect x="8" y="6" width="8" height="15" rx="1.5" fill="#6e7276"/><rect x="8" y="9" width="8" height="2" fill="#d8d8d8"/><path d="M9 5c0-2 2-3 3-3s3 1 3 3" fill="#aaa"/>'),
  heartbeat: s('<rect x="6" y="3" width="12" height="18" rx="2" fill="#3a3e42"/><rect x="7.5" y="5" width="9" height="9" fill="#1a3a2a"/><path d="M8 10h2l1-2 1.5 4 1-2H16" stroke="#6af06a" fill="none"/>'),
  stim: s('<path d="M10 3h4v3h-4z" fill="#555"/><rect x="9" y="6" width="6" height="12" rx="1" fill="#c8cc9a"/><rect x="10" y="8" width="4" height="6" fill="#7a3ab0"/><path d="M11.5 18h1v4h-1z" fill="#ccc"/>'),
  rock: s('<path d="M5 15l3-7 7-2 4 6-3 7H8z" fill="#8a857c"/>'),
  // killstreaks / field upgrades
  // counter UAV: ring drone with four rotor arms
  cuav: s('<circle cx="12" cy="12" r="6.5" fill="none" stroke="#fff" stroke-width="1.6"/><rect x="10.6" y="5" width="2.8" height="14" rx="1" fill="#fff"/><path d="M5.5 12h13M3 3l4.5 4.5M21 3l-4.5 4.5M3 21l4.5-4.5M21 21l-4.5-4.5" stroke="#fff" stroke-width="1.4"/>'),
  uav: s('<path d="M2 12l8-2 2-7 2 7 8 2-8 2-2 7-2-7z" fill="#fff"/>'),
  cluster: s('<circle cx="7" cy="8" r="3" fill="#fff"/><circle cx="16" cy="7" r="3" fill="#fff"/><circle cx="11" cy="15" r="3" fill="#fff"/><circle cx="18" cy="16" r="2.4" fill="#fff"/>'),
  airstrike: s('<path d="M12 2l2 8 8 3-8 1-1 8-1-8-8-1 8-3z" fill="#fff"/>'),
  turret: s('<rect x="4" y="6" width="16" height="10" rx="1" fill="#aaa"/><rect x="10" y="10" width="11" height="2" fill="#333"/><path d="M8 16l-3 6M16 16l3 6" stroke="#aaa" stroke-width="2"/>'),
  armorBox: s('<rect x="3" y="8" width="18" height="12" rx="1.5" fill="#5a6048"/><path d="M9 9h6l1.5 2v7h-9v-7z" fill="#b9bcbf"/>'),
  munitions: s('<rect x="3" y="8" width="18" height="12" rx="1.5" fill="#5a6048"/><rect x="7" y="11" width="2" height="6" fill="#d8b04a"/><rect x="11" y="11" width="2" height="6" fill="#d8b04a"/><rect x="15" y="11" width="2" height="6" fill="#d8b04a"/>'),
  loadout: s('<rect x="3" y="7" width="18" height="13" rx="1.5" fill="#3a4a30"/><path d="M3 11h18" stroke="#c83a2a" stroke-width="2"/><path d="M8 4c0 2 8 2 8 0" stroke="#aaa" fill="none"/>'),
  counterUav: s('<path d="M2 12l8-2 2-7 2 7 8 2-8 2-2 7-2-7z" fill="#fff"/><path d="M4 4l16 16" stroke="#e04a3c" stroke-width="2.5"/>'),
  buyback: s('<circle cx="12" cy="8" r="3.5" fill="#fff"/><path d="M5 21c0-5 3-8 7-8s7 3 7 8z" fill="#fff"/><path d="M18 3v6M15 6h6" stroke="#6ad36a" stroke-width="2"/>'),
  ammo: s('<rect x="4" y="9" width="16" height="11" rx="1" fill="#6a6a3a"/><rect x="6" y="5" width="2" height="5" fill="#d8b04a"/><rect x="10" y="5" width="2" height="5" fill="#d8b04a"/><rect x="14" y="5" width="2" height="5" fill="#d8b04a"/>'),
  contractBounty: s('<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="#fff"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5" stroke="#fff" stroke-width="2"/>'),
  contractScav: s('<circle cx="10" cy="10" r="6" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M14.5 14.5l6 6" stroke="#fff" stroke-width="3"/>'),
  contractRecon: s('<path d="M6 2v20" stroke="#fff" stroke-width="2"/><path d="M7 3h12l-3 4 3 4H7z" fill="#fff"/>'),
  supply: s('<rect x="3" y="8" width="18" height="11" rx="1.5" fill="#5a5f48"/><path d="M3 12h18" stroke="#ffd070" stroke-width="1.5"/>'),
  vehicle: s('<path d="M3 15l2-5h14l2 5v3H3z" fill="#fff"/><circle cx="7" cy="18" r="2" fill="#333"/><circle cx="17" cy="18" r="2" fill="#333"/>'),
  heli: s('<path d="M2 5h20" stroke="#fff" stroke-width="1.5"/><path d="M12 5v3M5 12c0-2 3-4 7-4s6 2 6 5-3 4-7 4H5z" fill="#fff"/><path d="M18 13h4" stroke="#fff" stroke-width="2"/>'),
  balloon: s('<ellipse cx="12" cy="9" rx="6" ry="7" fill="#fff"/><path d="M12 16v6" stroke="#fff"/>'),
  mouse: s('<rect x="7" y="3" width="10" height="18" rx="5" fill="none" stroke="#fff" stroke-width="1.6"/><path d="M12 3v6" stroke="#fff" stroke-width="1.6"/>'),
};

export const LETHAL_ICON: Record<string, string> = { frag: 'frag', semtex: 'semtex', knife: 'knife', molotov: 'molotov', c4: 'c4', claymore: 'claymore' };
export const TACTICAL_ICON: Record<string, string> = { stun: 'stun', flash: 'flash', smoke: 'smoke', heartbeat: 'heartbeat', stim: 'stim' };
export const STREAK_ICON: Record<string, string> = { uav: 'uav', cuav: 'cuav', cluster: 'cluster', airstrike: 'airstrike', turret: 'turret', counterUav: 'counterUav' };

/** Contract badge (canvas, 128 px) for the floating world marker and the maps: coloured disc + glyph per type. */
const badgeCache = new Map<string, HTMLCanvasElement>();
export const CONTRACT_COLOR: Record<string, string> = { bounty: '#e8503a', scavenger: '#3aa0e8', recon: '#f0b830' };
export function contractBadge(kind: string): HTMLCanvasElement {
  let c = badgeCache.get(kind); if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
  const col = CONTRACT_COLOR[kind] ?? '#fff';
  g.translate(64, 64);
  g.shadowColor = col; g.shadowBlur = 14;
  g.beginPath(); g.arc(0, 0, 50, 0, Math.PI * 2); g.fillStyle = 'rgba(12,14,16,0.82)'; g.fill();
  g.lineWidth = 7; g.strokeStyle = col; g.stroke(); g.shadowBlur = 0;
  g.strokeStyle = g.fillStyle = col; g.lineCap = 'round';
  if (kind === 'bounty') { // crosshair on a target
    g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 22, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(0, 0, 7, 0, Math.PI * 2); g.fill();
    for (const [x0, y0, x1, y1] of [[0, -36, 0, -16], [0, 16, 0, 36], [-36, 0, -16, 0], [16, 0, 36, 0]]) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
  } else if (kind === 'scavenger') { // magnifier over a supply box
    g.fillRect(-26, 4, 30, 22); g.fillStyle = 'rgba(12,14,16,0.9)'; g.fillRect(-24, 13, 26, 3); g.fillStyle = col;
    g.lineWidth = 6; g.beginPath(); g.arc(8, -10, 14, 0, Math.PI * 2); g.stroke(); g.lineWidth = 8; g.beginPath(); g.moveTo(18, 0); g.lineTo(30, 12); g.stroke();
  } else { // recon: flag on a pole
    g.lineWidth = 6; g.beginPath(); g.moveTo(-18, -30); g.lineTo(-18, 32); g.stroke();
    g.beginPath(); g.moveTo(-15, -30); g.lineTo(26, -30); g.lineTo(16, -17); g.lineTo(26, -4); g.lineTo(-15, -4); g.closePath(); g.fill();
  }
  badgeCache.set(kind, c); return c;
}
