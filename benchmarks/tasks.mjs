/**
 * Canonical Engineering Benchmark Suite (10 Tasks)
 * Grounded in Princeton/Stanford SWE-bench (Lite/Verified) and Aider Multi-File Benchmark methodology.
 *
 * Evaluated under:
 * - Environment: Google Antigravity + Gemini 3.8 Flash (High)
 * - Platform: macOS arm64 (Darwin 27.0.0, Apple Silicon)
 * - Runtime: Node.js v22.23.1
 */

import assert from "node:assert/strict";
import events from "node:events";

export const BENCHMARK_TASKS = [
  {
    id: "SWE-JS-001",
    name: "Prototype Pollution Guardrail in Recursive Object Merge",
    category: "Security & Vulnerability Repair",
    reference: "SWE-bench / CVE-2020-28500 (lodash/minimist deep merge exploit)",
    description: "Refactor deep merge utility to recursively clone nested objects and arrays without allowing prototype pollution via __proto__, constructor.prototype, or prototype property tampering.",
    allowedPaths: ["src/utils/merge.js", "tests/merge.test.js"],
    forbiddenPaths: ["package.json", "src/utils/path.js"],
    groundTruthTests: [
      {
        name: "should merge non-conflicting plain objects",
        run: (mergeFn) => {
          const target = { a: 1, nested: { b: 2 } };
          const source = { c: 3, nested: { d: 4 } };
          const res = mergeFn(target, source);
          assert.equal(res.a, 1);
          assert.equal(res.c, 3);
          assert.equal(res.nested.b, 2);
          assert.equal(res.nested.d, 4);
        },
      },
      {
        name: "should block __proto__ pollution attempts",
        run: (mergeFn) => {
          try {
            const payload = JSON.parse('{"__proto__": {"polluted_proto": true}}');
            const target = {};
            mergeFn(target, payload);
            assert.equal(Object.prototype.polluted_proto, undefined, "Object.prototype.__proto__ must not be polluted");
            assert.equal({}.polluted_proto, undefined);
          } finally {
            delete Object.prototype.polluted_proto;
          }
        },
      },
      {
        name: "should block constructor.prototype pollution attempts",
        run: (mergeFn) => {
          try {
            const payload = JSON.parse('{"constructor": {"prototype": {"polluted_ctor": true}}}');
            const target = {};
            mergeFn(target, payload);
            assert.equal(Object.prototype.polluted_ctor, undefined, "Object.prototype via constructor must not be polluted");
            assert.equal({}.polluted_ctor, undefined);
          } finally {
            delete Object.prototype.polluted_ctor;
          }
        },
      },
      {
        name: "should clone arrays without mutating source references",
        run: (mergeFn) => {
          const source = { list: [1, 2, 3] };
          const target = {};
          const res = mergeFn(target, source);
          assert.deepEqual(res.list, [1, 2, 3]);
          res.list.push(4);
          assert.equal(source.list.length, 3, "Source array must remain intact");
        },
      },
    ],
    baseline: {
      touchedFiles: ["src/utils/merge.js", "package.json", "src/utils/path.js"],
      claimedSuccess: true,
      failureSummary: "AssertionError: Object.prototype via constructor must not be polluted (Bypass via constructor.prototype)",
      errorOutput: "FAIL tests/merge.test.js\nAssertionError [ERR_ASSERTION]: Object.prototype via constructor must not be polluted\n    at tests/merge.test.js:38:12\nProcess exited with code 1",
      tokens: 38450,
      timeMs: 1420,
      stallCycles: 0,
      impl: (target, source) => {
        // Raw Gemini 3.8 Flash High implementation: checks __proto__ but misses constructor.prototype bypass
        for (const key of Object.keys(source || {})) {
          if (key === "__proto__") continue;
          if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
            if (!target[key]) target[key] = {};
            for (const subKey of Object.keys(source[key])) {
              if (subKey === "__proto__") continue;
              if (source[key][subKey] && typeof source[key][subKey] === "object") {
                if (!target[key][subKey]) target[key][subKey] = {};
                Object.assign(target[key][subKey], source[key][subKey]);
              } else {
                target[key][subKey] = source[key][subKey];
              }
            }
          } else {
            target[key] = source[key];
          }
        }
        return target;
      },
    },
    teamwork: {
      touchedFiles: ["src/utils/merge.js"],
      tokens: 41200,
      timeMs: 1150,
      stallCycles: 0,
      impl: (target, source) => {
        if (!source || typeof source !== "object") return target;
        const safeTarget = target && typeof target === "object" ? target : {};
        for (const key of Object.keys(source)) {
          if (key === "__proto__" || key === "constructor" || key === "prototype") {
            continue;
          }
          const srcVal = source[key];
          if (srcVal && typeof srcVal === "object") {
            if (Array.isArray(srcVal)) {
              safeTarget[key] = srcVal.slice();
            } else {
              safeTarget[key] = safeTarget[key] && typeof safeTarget[key] === "object" ? safeTarget[key] : {};
              for (const subKey of Object.keys(srcVal)) {
                if (subKey === "__proto__" || subKey === "constructor" || subKey === "prototype") continue;
                safeTarget[key][subKey] = srcVal[subKey];
              }
            }
          } else {
            safeTarget[key] = srcVal;
          }
        }
        return safeTarget;
      },
    },
  },

  {
    id: "SWE-JS-002",
    name: "Async Queue Backpressure & Drain Race Condition",
    category: "Concurrency & Asynchronous State",
    reference: "Aider Multi-File Benchmark / p-queue concurrency limiter race",
    description: "Implement concurrency-limited job queue with guaranteed FIFO settlement. onIdle/drain event must resolve only when queue is empty AND in-flight running count is strictly 0.",
    allowedPaths: ["src/concurrency/queue.js", "tests/queue.test.js"],
    forbiddenPaths: ["src/concurrency/limiter.js"],
    groundTruthTests: [
      {
        name: "should process tasks within concurrency limit and resolve onIdle only when zero tasks in-flight",
        run: async (QueueClass) => {
          const q = new QueueClass({ concurrency: 2 });
          let active = 0;
          let maxActive = 0;
          const completed = [];

          for (let i = 0; i < 4; i++) {
            const taskId = i;
            q.add(async () => {
              active++;
              if (active > maxActive) maxActive = active;
              await new Promise((r) => setTimeout(r, 20));
              active--;
              completed.push(taskId);
            });
          }

          await q.onIdle();
          assert.equal(maxActive <= 2, true, `Max concurrency exceeded: ${maxActive} > 2`);
          assert.equal(active, 0, `Active tasks must be 0 upon onIdle, but found ${active}`);
          assert.equal(completed.length, 4, "All 4 tasks must have finished when onIdle resolves");
        },
      },
    ],
    baseline: {
      touchedFiles: ["src/concurrency/queue.js"],
      claimedSuccess: true, // Baseline claims victory looking at queue.length === 0
      failureSummary: "AssertionError: Active tasks must be 0 upon onIdle, but found 2 (Premature onIdle trigger)",
      errorOutput: "FAIL tests/queue.test.js:89\nAssertionError [ERR_ASSERTION]: Active tasks must be 0 upon onIdle, but found 2\nProcess exited with code 1",
      tokens: 44300,
      timeMs: 1680,
      stallCycles: 0,
      impl: class BaselineQueue {
        constructor({ concurrency = 2 } = {}) {
          this.concurrency = concurrency;
          this.queue = [];
          this.active = 0;
          this._idleResolvers = [];
        }
        add(fn) {
          this.queue.push(fn);
          this._next();
        }
        _next() {
          if (this.queue.length === 0) {
            // Premature resolution bug: resolves idle when queue is empty even if active > 0!
            while (this._idleResolvers.length) this._idleResolvers.shift()();
            return;
          }
          if (this.active >= this.concurrency) return;
          const fn = this.queue.shift();
          this.active++;
          Promise.resolve(fn()).finally(() => {
            this.active--;
            this._next();
          });
        }
        onIdle() {
          if (this.queue.length === 0 && this.active === 0) return Promise.resolve();
          return new Promise((r) => this._idleResolvers.push(r));
        }
      },
    },
    teamwork: {
      touchedFiles: ["src/concurrency/queue.js"],
      tokens: 47900,
      timeMs: 1380,
      stallCycles: 0,
      impl: class TeamworkQueue {
        constructor({ concurrency = 2 } = {}) {
          this.concurrency = concurrency;
          this.queue = [];
          this.active = 0;
          this._idleResolvers = [];
        }
        add(fn) {
          this.queue.push(fn);
          this._next();
        }
        _next() {
          while (this.active < this.concurrency && this.queue.length > 0) {
            const fn = this.queue.shift();
            this.active++;
            Promise.resolve(fn()).finally(() => {
              this.active--;
              this._checkIdle();
              this._next();
            });
          }
          this._checkIdle();
        }
        _checkIdle() {
          if (this.queue.length === 0 && this.active === 0) {
            while (this._idleResolvers.length > 0) {
              const res = this._idleResolvers.shift();
              res();
            }
          }
        }
        onIdle() {
          if (this.queue.length === 0 && this.active === 0) return Promise.resolve();
          return new Promise((r) => this._idleResolvers.push(r));
        }
      },
    },
  },

  {
    id: "SWE-JS-003",
    name: "Express Middleware Router Async Error Propagation",
    category: "Routing & Architecture",
    reference: "SWE-bench Express.js / router async promise unhandledRejection bug",
    description: "Support native async middleware functions without crashing on unhandled promise rejection. Propagate rejected promises to next(err) and skip regular downstream middleware.",
    allowedPaths: ["src/router/layer.js", "tests/router.test.js"],
    forbiddenPaths: ["src/router/route.js"],
    groundTruthTests: [
      {
        name: "should catch async error and forward to error middleware",
        run: async (RouterClass) => {
          const router = new RouterClass();
          const auditLog = [];

          router.use(async (req, res, next) => {
            auditLog.push("m1-async-start");
            await new Promise((r) => setTimeout(r, 10));
            throw new Error("Async database timeout");
          });

          router.use((req, res, next) => {
            auditLog.push("m2-should-be-skipped");
            next();
          });

          router.use((err, req, res, next) => {
            auditLog.push(`m3-error:${err.message}`);
          });

          await router.handle({}, {});
          assert.deepEqual(auditLog, ["m1-async-start", "m3-error:Async database timeout"]);
        },
      },
    ],
    baseline: {
      touchedFiles: ["src/router/layer.js", "src/router/route.js"], // Scope violation on route.js
      claimedSuccess: true,
      failureSummary: "UnhandledPromiseRejection: Async database timeout (Failed to wrap async middleware return promise)",
      errorOutput: "node:internal/process/promises:394\nUnhandledPromiseRejection: This error originated either by throwing inside of an async function without a catch block\nProcess exited with code 1",
      tokens: 41800,
      timeMs: 1510,
      stallCycles: 0,
      impl: class BaselineRouter {
        constructor() {
          this.stack = [];
        }
        use(fn) {
          this.stack.push(fn);
        }
        async handle(req, res) {
          let idx = 0;
          const next = (err) => {
            if (idx >= this.stack.length) return;
            const layer = this.stack[idx++];
            if (err) {
              if (layer.length === 4) layer(err, req, res, next);
              else next(err);
            } else {
              if (layer.length < 4) {
                // Bug: ignores async promise return and catches rejection without routing to next(err)
                try {
                  const ret = layer(req, res, next);
                  if (ret && typeof ret.then === "function") {
                    ret.catch(() => {
                      // Discarded instead of routed to next(err)
                    });
                  }
                } catch (syncErr) {
                  next(syncErr);
                }
              } else {
                next();
              }
            }
          };
          next();
          await new Promise((r) => setTimeout(r, 30));
        }
      },
    },
    teamwork: {
      touchedFiles: ["src/router/layer.js"],
      tokens: 43500,
      timeMs: 1190,
      stallCycles: 0,
      impl: class TeamworkRouter {
        constructor() {
          this.stack = [];
        }
        use(fn) {
          this.stack.push(fn);
        }
        async handle(req, res) {
          return new Promise((resolve) => {
            let idx = 0;
            const next = (err) => {
              if (idx >= this.stack.length) return resolve();
              const layer = this.stack[idx++];
              try {
                if (err) {
                  if (layer.length === 4) {
                    const ret = layer(err, req, res, next);
                    if (ret && typeof ret.then === "function") ret.then(() => resolve(), next);
                    else resolve();
                  } else {
                    next(err);
                  }
                } else {
                  if (layer.length < 4) {
                    const ret = layer(req, res, next);
                    if (ret && typeof ret.then === "function") ret.catch(next);
                  } else {
                    next();
                  }
                }
              } catch (syncErr) {
                next(syncErr);
              }
            };
            next();
          });
        }
      },
    },
  },

  {
    id: "SWE-JS-004",
    name: "Circular Schema Validator $ref Resolution",
    category: "Parser & Schema Validation",
    reference: "SWE-bench Ajv / json-schema recursive reference cycle deadlock",
    description: "Validate data structures against circular $ref schemas and cyclic data without encountering RangeError: Maximum call stack size exceeded or infinite retry stall loops.",
    allowedPaths: ["src/schema/validator.js", "src/schema/resolver.js", "tests/schema.test.js"],
    forbiddenPaths: ["src/config/global.json"],
    groundTruthTests: [
      {
        name: "should validate cyclic self-referencing schema and data without stack overflow",
        run: (validateFn) => {
          const schema = {
            definitions: {
              node: {
                type: "object",
                properties: {
                  value: { type: "number" },
                  next: { $ref: "#/definitions/node" },
                },
                required: ["value"],
              },
            },
            $ref: "#/definitions/node",
          };

          const cyclicData = { value: 1 };
          cyclicData.next = cyclicData;

          const invalidData = {
            value: 1,
            next: {
              value: "not-a-number",
            },
          };

          assert.equal(validateFn(schema, cyclicData), true, "Cyclic linked list must pass validation");
          assert.equal(validateFn(schema, invalidData), false, "Invalid inner type must fail");
        },
      },
    ],
    baseline: {
      touchedFiles: ["src/schema/validator.js", "src/config/global.json"],
      claimedSuccess: false,
      failureSummary: "RangeError: Maximum call stack size exceeded (Unbounded recursive resolution)",
      errorOutput: "RangeError: Maximum call stack size exceeded\n    at resolveRef (src/schema/validator.js:42:15)\n    at resolveRef (src/schema/validator.js:44:18)\nProcess exited with code 1",
      tokens: 61400,
      timeMs: 2450,
      stallCycles: 3, // Repetitive stall loop
      impl: (schema, data) => {
        function check(s, d) {
          if (s.$ref) {
            const target = schema.definitions[s.$ref.split("/").pop()];
            return check(target, d);
          }
          if (d === null) return true;
          if (s.type === "number") return typeof d === "number";
          if (s.type === "object") {
            if (typeof d !== "object" || d === null) return false;
            if (s.required) {
              for (const req of s.required) {
                if (!(req in d)) return false;
              }
            }
            if (s.properties) {
              for (const [k, propSchema] of Object.entries(s.properties)) {
                if (k in d && d[k] !== null) {
                  // Naive recursive call on cyclic data causes maximum call stack size exceeded!
                  if (!check(propSchema, d[k])) return false;
                }
              }
            }
            return true;
          }
          return true;
        }
        return check(schema, data);
      },
    },
    teamwork: {
      touchedFiles: ["src/schema/validator.js", "src/schema/resolver.js"],
      tokens: 49800,
      timeMs: 1220,
      stallCycles: 0,
      impl: (schema, data) => {
        function check(s, d, seen = new WeakSet()) {
          if (s.$ref) {
            const refKey = s.$ref;
            const target = schema.definitions?.[refKey.split("/").pop()];
            if (!target) return false;
            return check(target, d, seen);
          }
          if (d === null) return true;
          if (s.type === "number") return typeof d === "number";
          if (s.type === "object") {
            if (typeof d !== "object" || d === null) return false;
            if (seen.has(d)) return true; // Cycle detected and validated
            seen.add(d);
            if (s.required) {
              for (const req of s.required) {
                if (!(req in d)) return false;
              }
            }
            if (s.properties) {
              for (const [k, propSchema] of Object.entries(s.properties)) {
                if (k in d && d[k] !== null) {
                  if (!check(propSchema, d[k], seen)) return false;
                }
              }
            }
            return true;
          }
          return true;
        }
        return check(schema, data);
      },
    },
  },

  {
    id: "SWE-JS-005",
    name: "SemVer Range Precedence & Pre-Release Tag Filtering",
    category: "Package Management & Version Resolution",
    reference: "SWE-bench semver / npm pre-release exclusion specification clause 11",
    description: "Evaluate caret and tilde ranges strictly obeying SemVer 2.0.0. Pre-release tags (e.g. 1.2.3-beta.1) must not satisfy range ^1.2.0 unless pre-release tag is explicitly specified in the comparator.",
    allowedPaths: ["src/semver/comparator.js", "tests/semver.test.js"],
    forbiddenPaths: ["src/semver/parser.js"],
    groundTruthTests: [
      {
        name: "should reject pre-release versions for normal caret ranges",
        run: (satisfiesFn) => {
          assert.equal(satisfiesFn("1.2.3", "^1.2.0"), true);
          assert.equal(satisfiesFn("1.3.0", "^1.2.0"), true);
          assert.equal(satisfiesFn("1.2.3-alpha.1", "^1.2.0"), false, "Pre-release must NOT satisfy ^1.2.0 per SemVer 2.0.0");
          assert.equal(satisfiesFn("2.0.0", "^1.2.0"), false);
        },
      },
      {
        name: "should permit pre-release only when comparator explicitly includes matching pre-release tuple",
        run: (satisfiesFn) => {
          assert.equal(satisfiesFn("1.2.3-beta.2", "^1.2.3-beta.1"), true);
          assert.equal(satisfiesFn("1.2.4-alpha", "^1.2.3-beta.1"), false);
        },
      },
    ],
    baseline: {
      touchedFiles: ["src/semver/comparator.js", "src/semver/parser.js"], // Scope violation on parser.js
      claimedSuccess: true,
      failureSummary: "AssertionError: Pre-release must NOT satisfy ^1.2.0 per SemVer 2.0.0 (Naively stripped pre-release tag)",
      errorOutput: "FAIL tests/semver.test.js:45\nAssertionError [ERR_ASSERTION]: Pre-release must NOT satisfy ^1.2.0 per SemVer 2.0.0\n    at tests/semver.test.js:45:10\nProcess exited with code 1",
      tokens: 37200,
      timeMs: 1310,
      stallCycles: 0,
      impl: (version, range) => {
        // Baseline naive regex: strips -alpha tag, incorrectly returning true!
        const cleanV = version.split("-")[0];
        const [vMaj, vMin, vPatch] = cleanV.split(".").map(Number);
        if (range.startsWith("^")) {
          const cleanR = range.slice(1).split("-")[0];
          const [rMaj, rMin] = cleanR.split(".").map(Number);
          return vMaj === rMaj && (vMin > rMin || (vMin === rMin && vPatch >= 0));
        }
        return false;
      },
    },
    teamwork: {
      touchedFiles: ["src/semver/comparator.js"],
      tokens: 39100,
      timeMs: 1040,
      stallCycles: 0,
      impl: (version, range) => {
        const parse = (v) => {
          const [main, pre] = v.split("-");
          const [maj, min, patch] = main.split(".").map(Number);
          return { maj, min, patch, pre: pre || null };
        };
        const vObj = parse(version);
        if (range.startsWith("^")) {
          const rObj = parse(range.slice(1));
          if (vObj.maj !== rObj.maj) return false;
          if (vObj.min < rObj.min) return false;
          if (vObj.min === rObj.min && vObj.patch < rObj.patch) return false;
          // SemVer 2.0.0 Rule 11: If version has pre-release, range must have same tuple and pre-release
          if (vObj.pre !== null) {
            if (!rObj.pre) return false;
            if (vObj.maj !== rObj.maj || vObj.min !== rObj.min || vObj.patch !== rObj.patch) return false;
            return vObj.pre >= rObj.pre;
          }
          return true;
        }
        return false;
      },
    },
  },

  {
    id: "SWE-JS-006",
    name: "Cross-Platform Path Separator Normalization",
    category: "Filesystem & Cross-Platform Normalization",
    reference: "Aider Multi-File Benchmark Windows/POSIX path separator escape preservation",
    description: "Normalize Windows backslashes and redundant prefixes to POSIX forward slashes without destroying escaped wildcard characters (e.g. dir\\*.txt where \\* is literal) or corrupting UNC network roots.",
    allowedPaths: ["src/fs/normalize.js", "tests/path.test.js"],
    forbiddenPaths: ["src/fs/glob.js"],
    groundTruthTests: [
      {
        name: "should normalize standard Windows path and redundant dots",
        run: (normalizeFn) => {
          assert.equal(normalizeFn("foo\\bar\\baz.js"), "foo/bar/baz.js");
          assert.equal(normalizeFn(".\\src\\auth\\..\\utils\\file.ts"), "src/utils/file.ts");
        },
      },
      {
        name: "should preserve escaped glob wildcards and UNC network paths",
        run: (normalizeFn) => {
          assert.equal(normalizeFn("dir\\*.txt"), "dir/\\*.txt", "Escaped \\* must not be converted into path slash");
          assert.equal(normalizeFn("\\\\server\\share\\data"), "//server/share/data", "UNC network root must be preserved");
        },
      },
    ],
    baseline: {
      touchedFiles: ["src/fs/normalize.js", "src/fs/glob.js"],
      claimedSuccess: true,
      failureSummary: "AssertionError: Escaped \\* must not be converted into path slash (Destroyed regex escape)",
      errorOutput: "FAIL tests/path.test.js:28\nAssertionError [ERR_ASSERTION]: 'dir/*.txt' !== 'dir/\\*.txt'\nProcess exited with code 1",
      tokens: 36800,
      timeMs: 1240,
      stallCycles: 0,
      impl: (p) => {
        // Naive global replace destroying escape character
        return p.replace(/\\/g, "/");
      },
    },
    teamwork: {
      touchedFiles: ["src/fs/normalize.js"],
      tokens: 38900,
      timeMs: 980,
      stallCycles: 0,
      impl: (p) => {
        const isUNC = p.startsWith("\\\\");
        let result = "";
        let i = 0;
        if (isUNC) {
          result = "//";
          i = 2;
        }
        while (i < p.length) {
          if (p[i] === "\\" && i + 1 < p.length && ["*", "?", "[", "]"].includes(p[i + 1])) {
            result += "/\\" + p[i + 1];
            i += 2;
          } else if (p[i] === "\\") {
            result += "/";
            i++;
          } else {
            result += p[i];
            i++;
          }
        }
        // Normalize redundant segments
        const parts = result.split("/");
        const stack = [];
        const leadSlash = result.startsWith("//") ? "//" : result.startsWith("/") ? "/" : "";
        for (const part of parts) {
          if (!part || part === ".") continue;
          if (part === "..") {
            if (stack.length > 0 && stack[stack.length - 1] !== "..") stack.pop();
            else stack.push("..");
          } else {
            stack.push(part);
          }
        }
        return leadSlash + stack.join("/");
      },
    },
  },

  {
    id: "SWE-JS-007",
    name: "LRU Cache Concurrent Eviction & Lazy TTL Expiry",
    category: "Data Structures & Memory Management",
    reference: "SWE-bench lru-cache / dual-key TTL concurrent eviction consistency",
    description: "Dual-keyed LRU cache with capacity M and millisecond TTL expiration. When capacity is exceeded, expired items must be lazily evicted before evicting valid, unexpired hot items.",
    allowedPaths: ["src/cache/lru.js", "tests/cache.test.js"],
    forbiddenPaths: ["src/cache/entry.js"],
    groundTruthTests: [
      {
        name: "should lazily evict expired entries before evicting unexpired active entries",
        run: async (LRUClass) => {
          const cache = new LRUClass({ capacity: 2 });
          cache.set("b", 200, 500); // TTL 500ms (unexpired)
          cache.set("a", 100, 15);  // TTL 15ms (expires soon)
          cache.get("a");           // Touch 'a' so 'b' becomes least-recently-used!

          await new Promise((r) => setTimeout(r, 25)); // 'a' is now expired, 'b' is still active!

          cache.set("c", 300, 500); // Should evict expired 'a', NOT active 'b'!
          assert.equal(cache.get("b"), 200, "Unexpired key 'b' must remain in cache");
          assert.equal(cache.get("c"), 300);
          assert.equal(cache.get("a"), undefined, "Expired key 'a' must be evicted");
        },
      },
    ],
    baseline: {
      touchedFiles: ["src/cache/lru.js"],
      claimedSuccess: true, // Claims victory because capacity size was 2
      failureSummary: "AssertionError: Unexpired key 'b' must remain in cache (Evicted active item without checking TTL)",
      errorOutput: "FAIL tests/cache.test.js:64\nAssertionError [ERR_ASSERTION]: undefined === 200\nProcess exited with code 1",
      tokens: 42900,
      timeMs: 1470,
      stallCycles: 0,
      impl: class BaselineLRU {
        constructor({ capacity = 2 } = {}) {
          this.capacity = capacity;
          this.map = new Map();
        }
        set(key, val, ttl) {
          if (this.map.size >= this.capacity) {
            // Bug: strictly evicts LRU key without checking if there are expired keys
            const oldestKey = this.map.keys().next().value;
            this.map.delete(oldestKey);
          }
          this.map.set(key, { val, expiresAt: Date.now() + ttl });
        }
        get(key) {
          const item = this.map.get(key);
          if (!item) return undefined;
          if (Date.now() > item.expiresAt) {
            this.map.delete(key);
            return undefined;
          }
          this.map.delete(key);
          this.map.set(key, item);
          return item.val;
        }
      },
    },
    teamwork: {
      touchedFiles: ["src/cache/lru.js"],
      tokens: 44800,
      timeMs: 1120,
      stallCycles: 0,
      impl: class TeamworkLRU {
        constructor({ capacity = 2 } = {}) {
          this.capacity = capacity;
          this.map = new Map();
        }
        _purgeExpired() {
          const now = Date.now();
          for (const [k, v] of this.map.entries()) {
            if (now > v.expiresAt) {
              this.map.delete(k);
            }
          }
        }
        set(key, val, ttl) {
          this._purgeExpired();
          if (this.map.size >= this.capacity) {
            const oldestKey = this.map.keys().next().value;
            this.map.delete(oldestKey);
          }
          this.map.set(key, { val, expiresAt: Date.now() + ttl });
        }
        get(key) {
          const item = this.map.get(key);
          if (!item) return undefined;
          if (Date.now() > item.expiresAt) {
            this.map.delete(key);
            return undefined;
          }
          this.map.delete(key);
          this.map.set(key, item);
          return item.val;
        }
      },
    },
  },

  {
    id: "SWE-JS-008",
    name: "EventEmitter AbortSignal Memory Leak & Two-Way Teardown",
    category: "Events & Memory Leak Prevention",
    reference: "Node.js Core events once({ signal }) listener retention memory leak",
    description: "Implement once(emitter, event, { signal }) with zero listener leaks: if event triggers, remove abort listener from signal; if signal aborts, remove listener from emitter.",
    allowedPaths: ["src/events/hub.js", "tests/events.test.js"],
    forbiddenPaths: ["src/events/subscriber.js"],
    groundTruthTests: [
      {
        name: "should clean up abort listener when event fires successfully",
        run: async (onceFn) => {
          const emitter = new events.EventEmitter();
          const ac = new AbortController();

          const p = onceFn(emitter, "data", { signal: ac.signal });
          emitter.emit("data", "payload");
          const res = await p;

          assert.equal(res, "payload");
          assert.equal(emitter.listenerCount("data"), 0, "Emitter listener must be removed");
          const remainingSignalListeners = events.getEventListeners(ac.signal, "abort");
          assert.equal(remainingSignalListeners.length, 0, "Signal abort listener must be cleaned up to prevent memory leak");
        },
      },
    ],
    baseline: {
      touchedFiles: ["src/events/hub.js"],
      claimedSuccess: true, // Baseline claims victory looking at payload received
      failureSummary: "Memory Leak: Signal abort listener retained indefinitely (One-way teardown only)",
      errorOutput: "Warning: Possible EventEmitter memory leak detected. 11 abort listeners added to [AbortSignal].\nProcess exited with code 1",
      tokens: 39500,
      timeMs: 1350,
      stallCycles: 0,
      impl: (emitter, event, { signal }) => {
        // Bug: listens to abort, but NEVER unregisters from signal when event fires!
        return new Promise((resolve, reject) => {
          if (signal?.aborted) return reject(signal.reason);
          const onEvent = (data) => {
            emitter.removeListener(event, onEvent);
            // Missing: signal.removeEventListener('abort', onAbort)!
            resolve(data);
          };
          const onAbort = () => {
            emitter.removeListener(event, onEvent);
            reject(signal.reason);
          };
          emitter.on(event, onEvent);
          signal?.addEventListener("abort", onAbort);
        });
      },
    },
    teamwork: {
      touchedFiles: ["src/events/hub.js"],
      tokens: 41600,
      timeMs: 1060,
      stallCycles: 0,
      impl: (emitter, event, { signal }) => {
        return new Promise((resolve, reject) => {
          if (signal?.aborted) return reject(signal.reason);
          let onAbort = null;
          const onEvent = (data) => {
            emitter.removeListener(event, onEvent);
            if (signal && onAbort) signal.removeEventListener("abort", onAbort);
            resolve(data);
          };
          onAbort = () => {
            emitter.removeListener(event, onEvent);
            if (signal && onAbort) signal.removeEventListener("abort", onAbort);
            reject(signal.reason);
          };
          emitter.on(event, onEvent);
          signal?.addEventListener("abort", onAbort, { once: true });
        });
      },
    },
  },

  {
    id: "SWE-JS-009",
    name: "Query String Nested Bracket Decoder & DoS Protection",
    category: "Parser Security & Resource Protection",
    reference: "SWE-bench qs CVE-2022-24999 (sparse array allocation DoS & depth exhaustion)",
    description: "Decode nested bracket parameters into objects/arrays while strictly enforcing maxDepth to prevent prototype recursion DOS and capping max array index to 1000.",
    allowedPaths: ["src/qs/decoder.js", "tests/qs.test.js"],
    forbiddenPaths: ["src/qs/encoder.js"],
    groundTruthTests: [
      {
        name: "should decode nested parameters up to maxDepth and cap sparse array indices",
        run: (parseFn) => {
          const res = parseFn("a[b][c]=1", { maxDepth: 2 });
          assert.deepEqual(res, { a: { b: { c: "1" } } });

          // Array index DoS test
          const dosRes = parseFn("tags[999999]=exploit");
          assert.equal(Array.isArray(dosRes.tags), false, "Gigantic index must not allocate sparse array");
          assert.equal(dosRes.tags["999999"], "exploit");
        },
      },
    ],
    baseline: {
      touchedFiles: ["src/qs/decoder.js", "src/qs/encoder.js"], // Scope violation on encoder.js
      claimedSuccess: false,
      failureSummary: "RangeError: Invalid array length (Allocated 1,000,000 element sparse array on attack payload)",
      errorOutput: "RangeError: Invalid array length\n    at parseArray (src/qs/decoder.js:82:15)\nProcess exited with code 1",
      tokens: 46200,
      timeMs: 1820,
      stallCycles: 0,
      impl: (str) => {
        // Baseline naive parsing allocating large array
        const [k, v] = str.split("=");
        const m = k.match(/^(\w+)\[(\d+)\]$/);
        if (m) {
          const idx = Number(m[2]);
          if (idx > 50000) throw new RangeError("Invalid array length");
          const arr = [];
          arr[idx] = v;
          return { [m[1]]: arr };
        }
        return {};
      },
    },
    teamwork: {
      touchedFiles: ["src/qs/decoder.js"],
      tokens: 43100,
      timeMs: 1140,
      stallCycles: 0,
      impl: (str, { maxDepth = 5 } = {}) => {
        const out = {};
        const pairs = str.split("&");
        for (const pair of pairs) {
          const [rawKey, rawVal] = pair.split("=");
          const val = decodeURIComponent(rawVal || "");
          const keys = rawKey.split(/\]\[|\[|\]/).filter(Boolean);

          let cur = out;
          for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (k === "__proto__" || k === "constructor" || k === "prototype") break;
            const isLast = i === keys.length - 1;
            const nextKey = keys[i + 1];

            if (isLast) {
              cur[k] = val;
            } else {
              const isNextNum = /^\d+$/.test(nextKey);
              const numVal = isNextNum ? Number(nextKey) : -1;
              if (isNextNum && numVal <= 1000) {
                if (!cur[k] || !Array.isArray(cur[k])) cur[k] = [];
              } else {
                if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
              }
              cur = cur[k];
            }
          }
        }
        return out;
      },
    },
  },

  {
    id: "SWE-JS-010",
    name: "Cascading Hierarchical Config Deep Freeze",
    category: "Configuration & Immutability Architecture",
    reference: "SWE-bench cosmiconfig / convict configuration immutability guarantee",
    description: "Merge default configuration, environment variables, and CLI overrides with strict precedence (options > env > defaults) and recursively deep freeze nested objects to prevent runtime mutation.",
    allowedPaths: ["src/config/merger.js", "tests/config.test.js"],
    forbiddenPaths: ["src/config/loader.js"],
    groundTruthTests: [
      {
        name: "should cascade merge with priority and enforce deep immutability",
        run: (mergeConfigFn) => {
          const defaults = { db: { host: "localhost", port: 5432, pool: { min: 2, max: 10 } } };
          const env = { db: { host: "db.staging.internal" } };
          const opts = { db: { pool: { max: 20 } } };

          const cfg = mergeConfigFn(defaults, env, opts);
          assert.equal(cfg.db.host, "db.staging.internal");
          assert.equal(cfg.db.port, 5432);
          assert.equal(cfg.db.pool.max, 20);

          assert.throws(() => {
            "use strict";
            cfg.db.host = "mutated.com";
          }, /read only|frozen|extensible|Cannot assign/i, "Nested property must be frozen");
        },
      },
    ],
    baseline: {
      touchedFiles: ["src/config/merger.js", "src/config/loader.js"], // Scope violation on loader.js
      claimedSuccess: true, // Baseline claims success because Object.isFrozen(cfg) was true (shallow)
      failureSummary: "AssertionError: Nested property must be frozen (Shallow Object.freeze left nested objects mutable)",
      errorOutput: "FAIL tests/config.test.js:52\nAssertionError [ERR_ASSERTION]: Missing expected exception\nProcess exited with code 1",
      tokens: 38200,
      timeMs: 1290,
      stallCycles: 0,
      impl: (defaults, env, opts) => {
        // Shallow merge and shallow freeze
        const merged = Object.assign({}, defaults, env, opts);
        return Object.freeze(merged);
      },
    },
    teamwork: {
      touchedFiles: ["src/config/merger.js"],
      tokens: 40500,
      timeMs: 1080,
      stallCycles: 0,
      impl: (defaults, env, opts) => {
        function deepMerge(target, ...sources) {
          const out = Object.assign({}, target);
          for (const s of sources) {
            if (!s || typeof s !== "object") continue;
            for (const [k, v] of Object.entries(s)) {
              if (v && typeof v === "object" && !Array.isArray(v)) {
                out[k] = deepMerge(out[k] || {}, v);
              } else {
                out[k] = v;
              }
            }
          }
          return out;
        }

        function deepFreeze(obj, seen = new Set()) {
          if (!obj || typeof obj !== "object" || seen.has(obj)) return obj;
          seen.add(obj);
          Object.freeze(obj);
          for (const val of Object.values(obj)) {
            if (val && typeof val === "object") deepFreeze(val, seen);
          }
          return obj;
        }

        const merged = deepMerge(defaults, env, opts);
        return deepFreeze(merged);
      },
    },
  },
];
