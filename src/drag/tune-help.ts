export const TUNE_HINTS: Record<string, string> = {
  shift: 'AUTO changes gear at SHIFT AT; MANUAL waits for your shift key. No drive reaches the wheels while a shift happens.',
  shiftRpm: 'The revs where AUTO changes up. Higher uses more of each gear but can hit the limiter before the shift.',
  launchRpm: 'The revs held on the line when you press the gas. Higher dumps more clutch energy into the slicks on launch.',
  launchAggression: 'How fast and hard the automatic clutch bites. Low slips longer and heats the clutch more; high hits the tires harder. ',
  boostLimit: 'How much of the blower boost you ask for. Above 80% it spools harder but soaks more heat into the clutch and engine (RISK).',
  final: 'Multiplies every gear ratio: higher pulls harder in all gears but reaches a lower top speed.',
  pressure: '28 PSI is normal: lower grips more but rolls heavier; higher rolls easier but grips less.',
  ballast: 'Weight over the rear: more grip to launch with, but more mass to accelerate and slow with the aero and chute.',
  fuel: 'Fuel burns with engine work: a lighter car accelerates and stops more easily, but the rear tires carry less weight as the tank empties. Full is the quiet tune; less is a fine-tuning row for a long session.',
  stiffness: 'Spring stiffness: soft lets the nose rise and shifts weight onto the rear slicks; stiff keeps the nose down.',
  wheelieBar: 'How far the nose may lift before the bar stops it. Longer allows a bigger wheelie and more rear weight.',
  nitroShot: 'How much of the allowed bottle charge you use: more torque while it fires, but it drains the charge faster.',
  nitroGear: '0 means press the nitro key yourself; a gear number fires the bottle automatically from that gear. The auto driver fires in second when set to BY HAND.',
  statsTab: 'Your car numbers, clutch condition and a predicted timeslip for this tune in the current conditions.',
  tuningTab: 'Change the car setup. Every change is saved at once.',
  test: 'A free-play race that records nothing: use it to try the tune.',
  reset: 'Put the tune back to its stock settings.',
  back: 'Return to the menu you came from.',
};

export const tuneHint = (id: string): string => id.startsWith('gear') ? 'This gear ratio, with FINAL DRIVE: higher gives more wheel torque but a lower top speed in this gear.' : TUNE_HINTS[id] ?? '';
