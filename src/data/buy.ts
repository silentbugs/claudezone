/** Buy station catalogue (Warzone BR, 2020). Prices from the launch/Season 3-4 lists. */
export type BuyId = 'plates' | 'gasMask' | 'selfRevive' | 'uav' | 'cluster' | 'airstrike' | 'turret' | 'munitions' | 'armorBox' | 'loadout' | 'buyback';
export interface BuyItem { id: BuyId; name: string; price: number; icon: string; desc: string; cat: 'Equipment' | 'Killstreaks' | 'Field Upgrades' | 'Squad' }
export const BUY_ITEMS: BuyItem[] = [
  { id: 'plates', name: 'Armor Plate Bundle', price: 1500, icon: 'plate', cat: 'Equipment', desc: 'Fills your armor plate pouch (5 plates, 8 with a satchel).' },
  { id: 'gasMask', name: 'Gas Mask', price: 3000, icon: 'gasMask', cat: 'Equipment', desc: 'Puts itself on in the gas. 12 seconds of protection.' },
  { id: 'selfRevive', name: 'Self-Revive Kit', price: 4500, icon: 'selfRevive', cat: 'Equipment', desc: 'Get yourself back up when downed. Hold Use while downed.' },
  { id: 'uav', name: 'UAV', price: 4000, icon: 'uav', cat: 'Killstreaks', desc: 'Sweeps for enemies around you for 40 seconds. Shows them on the minimap.' },
  { id: 'cluster', name: 'Cluster Strike', price: 3000, icon: 'cluster', cat: 'Killstreaks', desc: 'Call a carpet of cluster bombs on a location.' },
  { id: 'airstrike', name: 'Precision Airstrike', price: 3500, icon: 'airstrike', cat: 'Killstreaks', desc: 'Two jets strafe a line through the target.' },
  { id: 'turret', name: 'Shield Turret', price: 2000, icon: 'turret', cat: 'Killstreaks', desc: 'A mounted machine gun behind a ballistic shield. Deploy, then man it.' },
  { id: 'munitions', name: 'Munitions Box', price: 5000, icon: 'munitions', cat: 'Field Upgrades', desc: 'Deployable box that refills ammo, lethal and tactical equipment for your squad.' },
  { id: 'armorBox', name: 'Armor Box', price: 4500, icon: 'armorBox', cat: 'Field Upgrades', desc: 'Deployable box that fully re-plates your squad and refills plate pouches.' },
  { id: 'loadout', name: 'Loadout Drop', price: 10000, icon: 'loadout', cat: 'Squad', desc: 'A crate with your custom classes drops at your location. One pick per player.' },
  { id: 'buyback', name: 'Squad Buyback', price: 4500, icon: 'buyback', cat: 'Squad', desc: 'Redeploy a dead teammate. They parachute back in.' },
];
export const BUY = Object.fromEntries(BUY_ITEMS.map((b) => [b.id, b])) as Record<BuyId, BuyItem>;
