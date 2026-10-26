// npm run sim -- [phase=3] [days=10] [day=1]
import { runHarness, resolveTargets, PhaseId } from '../src/index';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));
const phase = Number(args.phase ?? 3) as PhaseId;
const days = Number(args.days ?? 10);
const startDay = Number(args.day ?? 1);

const res = await runHarness({ phase, days, startDayInPhase: startDay });
console.log(`Phase ${phase}, ${days} simulated days from day ${startDay}\n`);
console.log('day  shots  peakWC  P2db   ODB     ODB target  EC    drain  changes');
for (const d of res.days) {
  const t = resolveTargets(phase, d.dayInPhase);
  console.log(
    `${String(d.dayInPhase).padStart(3)}  ${String(d.shots).padStart(5)}  ${String(d.peakWc).padStart(6)}  ${String(d.avgP2Dryback ?? '—').padStart(4)}  ` +
    `${String(d.odb ?? '—').padStart(5)}   ${t.odb.min}–${t.odb.max}`.padEnd(14) +
    `  ${String(d.avgEc ?? '—').padStart(4)}  ${String(d.drainPctEst ?? '—').padStart(4)}%  ${d.changes.map((c) => `${c.key} ${c.from}→${c.to}`).join('; ')}`,
  );
}
