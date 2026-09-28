import assert from "node:assert/strict";
import { createLimiter } from "../src/lib/rate-limit.ts";

let time = 0;
const limiter = createLimiter({ perMinute: 2, perDay: 3, globalPerDay: 5 }, () => time);

// Per-minute limit
assert.equal(limiter.check("a").ok, true);
assert.equal(limiter.check("a").ok, true);
const blocked = limiter.check("a");
assert.equal(blocked.ok, false);
assert.equal(!blocked.ok && blocked.scope, "minute");
assert.equal(!blocked.ok && blocked.retryAfterSeconds, 60);

// A rejected request must not consume the daily allowance.
time = 61_000;
assert.equal(limiter.check("a").ok, true); // 3rd daily request
const daily = limiter.check("a");
assert.equal(!daily.ok && daily.scope, "day");

// Other clients are independent until the global cap.
assert.equal(limiter.check("b").ok, true); // global 4
assert.equal(limiter.check("c").ok, true); // global 5
const global = limiter.check("d");
assert.equal(!global.ok && global.scope, "global");

// Everything resets after a day.
time = 61_000 + 24 * 60 * 60_000;
assert.equal(limiter.check("a").ok, true);

console.log("Rate limit regression passed.");
