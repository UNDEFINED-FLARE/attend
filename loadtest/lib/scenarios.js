// Scenario shapes shared by the registration and check-in tests.
import { env, int } from "./config.js";

const RAMP_LEVELS = [100, 500, 1000, 5000, 10000];

/** Step up through 100 → 500 → 1k → 5k → 10k VUs, holding each level, then ramp down. */
export function rampScenario(exec) {
  const rampUp = env("RAMP_UP", "1m");
  const hold = env("RAMP_HOLD", "2m");
  const max = int("RAMP_MAX_VUS", 10000);
  const stages = [];
  for (const level of RAMP_LEVELS.filter((l) => l <= max)) {
    stages.push({ target: level, duration: rampUp }, { target: level, duration: hold });
  }
  stages.push({ target: 0, duration: "1m" });
  return { ramp: { executor: "ramping-vus", exec, startVUs: 0, stages, gracefulRampDown: "30s" } };
}

/** Exactly `count` iterations started evenly over `duration` (e.g. 5,000 check-ins in 60 s). */
export function burstScenario(name, exec, count, duration) {
  return {
    [name]: {
      executor: "constant-arrival-rate", exec,
      rate: count, timeUnit: duration, duration,
      preAllocatedVUs: int("PREALLOCATED_VUS", Math.min(count, 2000)),
      maxVUs: int("MAX_VUS", count),
      gracefulStop: "60s",
    },
  };
}
