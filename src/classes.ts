// The class ids and bounds come from ONE file: backend/src/classes.ts (pure data, no imports), which the leaderboard server also uses. Add a class THERE (its header lists every place that needs a row).
// This file re-exports it and adds what only the game needs: names to show on screen.
export * from '../backend/src/classes.ts';
import { isClassId, type ClassId } from '../backend/src/classes.ts';

/** the class a player races in when they have not run the benchmark yet (no score is sent from it) */
export const DEFAULT_CLASS: ClassId = 'integrated';

/** the name shown on screen */
const CLASS_LABELS: Record<ClassId, string> = { integrated: 'INTEGRATED', discrete: 'DISCRETE' };
export function classLabel(id: ClassId): string { return isClassId(id) ? CLASS_LABELS[id] : 'UNKNOWN CLASS'; }
/** a line saying what the class covers */
const CLASS_NOTES: Record<ClassId, string> = { integrated: 'graphics built into the processor or a phone chip', discrete: 'a separate graphics card' };
export function classNote(id: ClassId): string { return isClassId(id) ? CLASS_NOTES[id] : ''; }
