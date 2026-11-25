// Numbers and colours shared by the simulation and the renderers.
export const C = { mag: '#ff2bd6', cyan: '#21e6ff', vio: '#8a5cff', yel: '#ffe14d', red: '#ff3355', org: '#ff8a1f', white: '#bdf7ff' };
// distances in road units: the bottom of the screen is Z0 away, enemies fight 3-8 ahead, things appear at SPAWN
// AIM: where the crosshair is (the cannons converge there); K: world units per second for each point of speed
export const Z0 = 1, FAR = 60, SPAWN = 40, AIM = 4.5, K = 0.12, RANGE = 20;   // RANGE: how far your shots reach
export const BOSS_KINDS = ['viper', 'hauler', 'ship', 'machinehead'];   // the bosses take turns, each with its own scenery: mountains, a city, a beach, and space
export const BOSS_HP_MULT = 2, BOSS_DMG_MULT = 2;   // the bosses have twice the health and hit twice as hard (what the boss itself fires; the lesser cars are unchanged)
export const BOSS_FIRST = 1100, BOSS_EVERY = 1100;   // the Viper arrives after this much road (about a minute and a half), then a boss every BOSS_EVERY
export const BANK_RATE = 0.25;   // the share of a run's score added to your points
export const LANES = [-2 / 3, 0, 2 / 3];
export const SHIP_LEN = 4.8, SHIP_W = 0.55, SHIP_DECK = 0.32, TURRETS = [0.12, 0.52, 0.78];   // the turrets' places along the hull (fractions of its length)
export const OFF_STEP = 0.5, HILL_AMP = 0.65;
