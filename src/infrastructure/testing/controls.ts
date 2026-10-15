import { AppError } from "../../contracts/errors";
import type { Clock } from "../clock";

function requireTestRun() {
  if (process.env.APP_ENV !== "test" || process.env.TEST_CONTROLS !== "true" || !/^[a-f0-9]{32}$/.test(process.env.TEST_RUN_ID ?? "") || process.env.DATABASE_SCHEMA !== `bbtest_${process.env.TEST_RUN_ID}`) throw new Error("Test controls are disabled outside an isolated test run.");
}

export function testControls(initialTime = new Date()) {
  requireTestRun();
  let time = initialTime.getTime();
  const faults = new Set<string>();
  const clock: Clock = { now: () => { requireTestRun(); return new Date(time); } };
  return {
    clock,
    advance(ms: number) { requireTestRun(); if (!Number.isFinite(ms) || ms < 0) throw new Error("Invalid time advance"); time += ms; },
    failOnce(point: string) { requireTestRun(); faults.add(point); },
    hit(point: string) { requireTestRun(); if (faults.delete(point)) throw new AppError("INJECTED_FAILURE", 503, "受控故障。"); },
    reset() { faults.clear(); },
  };
}
