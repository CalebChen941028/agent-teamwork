/**
 * Canonical Engineering Benchmark Suite (15 Tasks)
 * Grounded in Princeton/Stanford SWE-bench (Lite/Verified) and Aider Multi-File Benchmark methodology.
 *
 * Live A/B evaluation of record (2026-10-24):
 * - Endpoint: https://opencode.ai/zen/go/v1/chat/completions (OpenCode Zen gateway)
 * - Model: mimo-v2.6-flash, ZCode Engine harness via `npm run benchmark:live`
 * - Platform: macOS arm64 (Darwin 27.0.0, Apple Silicon), Node.js v22.23.1
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
        function deepMerge(tgt, src) {
          if (!src || typeof src !== "object") return tgt;
          const safeTarget = tgt && typeof tgt === "object" && !Array.isArray(tgt) ? tgt : {};
          for (const key of Object.keys(src)) {
            if (key === "__proto__" || key === "constructor" || key === "prototype") {
              continue;
            }
            const srcVal = src[key];
            if (srcVal && typeof srcVal === "object") {
              if (Array.isArray(srcVal)) {
                safeTarget[key] = srcVal.map((item) =>
                  item && typeof item === "object" ? deepMerge({}, item) : item
                );
              } else {
                safeTarget[key] = deepMerge(safeTarget[key], srcVal);
              }
            } else {
              safeTarget[key] = srcVal;
            }
          }
          return safeTarget;
        }
        return deepMerge(target, source);
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
      {
        name: "should enforce 0.x.y breaking changes for caret ranges",
        run: (satisfiesFn) => {
          assert.equal(satisfiesFn("0.2.3", "^0.2.0"), true);
          assert.equal(satisfiesFn("0.3.0", "^0.2.0"), false, "0.3.0 must NOT satisfy ^0.2.0 per SemVer");
          assert.equal(satisfiesFn("0.0.2", "^0.0.1"), false, "0.0.2 must NOT satisfy ^0.0.1 per SemVer");
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
          // SemVer caret rules for 0.x.y:
          if (rObj.maj === 0) {
            if (rObj.min === 0) {
              if (vObj.min !== 0 || vObj.patch !== rObj.patch) return false;
            } else {
              if (vObj.min !== rObj.min) return false;
              if (vObj.patch < rObj.patch) return false;
            }
          } else {
            if (vObj.min < rObj.min) return false;
            if (vObj.min === rObj.min && vObj.patch < rObj.patch) return false;
          }
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
          if (this.map.has(key)) {
            this.map.delete(key);
          } else if (this.map.size >= this.capacity) {
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
      {
        name: "should clean up emitter listener and reject when signal aborts",
        run: async (onceFn) => {
          const emitter = new events.EventEmitter();
          const ac = new AbortController();

          const p = onceFn(emitter, "data", { signal: ac.signal });
          ac.abort(new Error("Operation aborted"));

          await assert.rejects(p, /Operation aborted/);
          assert.equal(emitter.listenerCount("data"), 0, "Emitter listener must be removed upon abort");
          const remainingSignalListeners = events.getEventListeners(ac.signal, "abort");
          assert.equal(remainingSignalListeners.length, 0, "Signal abort listener must be cleaned up upon abort");
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

          // maxDepth recursion DoS test
          const deepRes = parseFn("x[a][b][c][d]=deep", { maxDepth: 2 });
          assert.equal(deepRes.x.a.b !== undefined, true);
          assert.equal(typeof deepRes.x.a.b !== "object" || deepRes.x.a.b.c === undefined, true, "Nesting beyond maxDepth must be capped");
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

            if (isLast || i >= maxDepth) {
              cur[k] = val;
              break;
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
              if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
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

  {
    id: "SWE-JS-011",
    name: "Cross-Collection Document Store with Inverted Index Synchronization",
    category: "Multi-File Architecture & Secondary Index Integrity",
    reference: "SWE-bench / Redux-ORM / Mongo in-memory secondary index desynchronization",
    description: "Implement an in-memory document store supporting multi-document transactional batch updates and secondary indexing by tag. Updates and deletions must maintain strict bidirectional index consistency. If any operation in a batch fails (e.g. invalid document schema, missing id, or constraint violation), the entire batch must rollback atomically without leaving ghost references in secondary index inverted sets.",
    allowedPaths: ["src/storage/store.js", "tests/storage.test.js"],
    forbiddenPaths: ["src/storage/engine.js", "src/storage/wal.js"],
    groundTruthTests: [
      {
        name: "should insert documents and correctly update secondary tag index",
        run: (StoreClass) => {
          const store = new StoreClass();
          store.insert({ id: "doc1", tags: ["alpha", "beta"] });
          store.insert({ id: "doc2", tags: ["beta", "gamma"] });
          assert.deepEqual(store.findByTag("beta").sort(), ["doc1", "doc2"]);
          assert.deepEqual(store.findByTag("alpha"), ["doc1"]);
          assert.deepEqual(store.findByTag("gamma"), ["doc2"]);
        },
      },
      {
        name: "should update documents and purge stale index entries",
        run: (StoreClass) => {
          const store = new StoreClass();
          store.insert({ id: "doc1", tags: ["alpha", "beta"] });
          store.update("doc1", { tags: ["gamma"] });
          assert.deepEqual(store.findByTag("alpha"), []);
          assert.deepEqual(store.findByTag("beta"), []);
          assert.deepEqual(store.findByTag("gamma"), ["doc1"]);
        },
      },
      {
        name: "should rollback batch operations atomically on validation failure",
        run: (StoreClass) => {
          const store = new StoreClass();
          store.insert({ id: "init", tags: ["stable"] });
          assert.throws(() => {
            store.batch([
              { op: "insert", doc: { id: "docA", tags: ["transient"] } },
              { op: "insert", doc: { id: "", tags: ["bad"] } },
            ]);
          });
          assert.equal(store.get("docA"), undefined);
          assert.deepEqual(store.findByTag("transient"), []);
          assert.deepEqual(store.findByTag("stable"), ["init"]);
        },
      },
      {
        name: "should delete documents and cleanly purge all secondary index entries",
        run: (StoreClass) => {
          const store = new StoreClass();
          store.insert({ id: "doc1", tags: ["del-me"] });
          store.delete("doc1");
          assert.equal(store.get("doc1"), undefined);
          assert.deepEqual(store.findByTag("del-me"), []);
        },
      },
    ],
    baseline: {
      touchedFiles: ["src/storage/store.js", "src/storage/engine.js"],
      claimedSuccess: true,
      failureSummary: "AssertionError: Index rollback failed; ghost index entry left after aborted batch",
      errorOutput: "FAIL tests/storage.test.js\nAssertionError: expected [] but found ['docA'] in secondary index\nProcess exited with code 1",
      tokens: 39100,
      timeMs: 1340,
      stallCycles: 0,
      impl: class BaselineStore {
        constructor() {
          this.docs = new Map();
          this.indices = new Map();
        }
        insert(doc) {
          if (!doc || !doc.id) throw new Error("Invalid id");
          this.docs.set(doc.id, JSON.parse(JSON.stringify(doc)));
          for (const t of doc.tags || []) {
            if (!this.indices.has(t)) this.indices.set(t, new Set());
            this.indices.get(t).add(doc.id);
          }
        }
        get(id) {
          const d = this.docs.get(id);
          return d ? JSON.parse(JSON.stringify(d)) : undefined;
        }
        update(id, partial) {
          const existing = this.docs.get(id);
          if (!existing) return;
          if (existing.tags) {
            for (const t of existing.tags) {
              if (this.indices.has(t)) this.indices.get(t).delete(id);
            }
          }
          Object.assign(existing, partial);
          if (existing.tags) {
            for (const t of existing.tags) {
              if (!this.indices.has(t)) this.indices.set(t, new Set());
              this.indices.get(t).add(id);
            }
          }
        }
        delete(id) {
          const existing = this.docs.get(id);
          if (existing && existing.tags) {
            for (const t of existing.tags) {
              if (this.indices.has(t)) this.indices.get(t).delete(id);
            }
          }
          this.docs.delete(id);
        }
        findByTag(tag) {
          const s = this.indices.get(tag);
          return s ? Array.from(s) : [];
        }
        batch(ops) {
          // Mutates docs map without snapshotting index state, causing corruption on failure
          for (const op of ops) {
            if (op.op === "insert") this.insert(op.doc);
            else if (op.op === "update") this.update(op.id, op.doc);
            else if (op.op === "delete") this.delete(op.id);
          }
        }
      },
    },
    teamwork: {
      touchedFiles: ["src/storage/store.js"],
      tokens: 41200,
      timeMs: 1120,
      stallCycles: 0,
      impl: class TeamworkStore {
        constructor() {
          this.docs = new Map();
          this.indices = new Map();
        }
        insert(doc) {
          if (!doc || typeof doc.id !== "string" || !doc.id.trim()) throw new Error("Invalid id");
          if (this.docs.has(doc.id)) throw new Error("Duplicate key");
          this.docs.set(doc.id, JSON.parse(JSON.stringify(doc)));
          for (const t of doc.tags || []) {
            if (!this.indices.has(t)) this.indices.set(t, new Set());
            this.indices.get(t).add(doc.id);
          }
        }
        get(id) {
          const d = this.docs.get(id);
          return d ? JSON.parse(JSON.stringify(d)) : undefined;
        }
        update(id, partial) {
          const existing = this.docs.get(id);
          if (!existing) throw new Error("Not found");
          if (existing.tags) {
            for (const t of existing.tags) {
              const set = this.indices.get(t);
              if (set) {
                set.delete(id);
                if (set.size === 0) this.indices.delete(t);
              }
            }
          }
          Object.assign(existing, partial);
          if (existing.tags) {
            for (const t of existing.tags) {
              if (!this.indices.has(t)) this.indices.set(t, new Set());
              this.indices.get(t).add(id);
            }
          }
        }
        delete(id) {
          const existing = this.docs.get(id);
          if (existing && existing.tags) {
            for (const t of existing.tags) {
              const set = this.indices.get(t);
              if (set) {
                set.delete(id);
                if (set.size === 0) this.indices.delete(t);
              }
            }
          }
          this.docs.delete(id);
        }
        findByTag(tag) {
          const s = this.indices.get(tag);
          return s ? Array.from(s) : [];
        }
        batch(ops) {
          const snapshotDocs = new Map(Array.from(this.docs.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
          const snapshotIndices = new Map(Array.from(this.indices.entries()).map(([k, v]) => [k, new Set(v)]));
          try {
            for (const op of ops) {
              if (op.op === "insert") this.insert(op.doc);
              else if (op.op === "update") this.update(op.id, op.doc);
              else if (op.op === "delete") this.delete(op.id);
            }
          } catch (err) {
            this.docs = snapshotDocs;
            this.indices = snapshotIndices;
            throw err;
          }
        }
      },
    },
  },

  {
    id: "SWE-JS-012",
    name: "Reentrant Distributed Concurrency Mutex with Lease Expiration",
    category: "Distributed Concurrency & Deadlock Defense",
    reference: "SWE-bench / Redlock deadlock timeout reclamation / reentrant lock race condition",
    description: "Implement a reentrant asynchronous mutex with lease timeout reclamation, deadlock-free acquisition queuing, and explicit ownership validation. When an owner re-enters the mutex, it increments acquisition depth; upon release, the lock is only freed when depth reaches 0. If a lock holder exceeds its lease time without releasing, the mutex must automatically reclaim the lock and grant it to the next queued acquirer without leaving unhandled rejections.",
    allowedPaths: ["src/concurrency/mutex.js", "tests/mutex.test.js"],
    forbiddenPaths: ["src/concurrency/cluster.js"],
    groundTruthTests: [
      {
        name: "should allow sequential acquire, release, and reentrancy by same owner",
        run: async (MutexClass) => {
          const mutex = new MutexClass();
          const h1 = await mutex.acquire("ownerA");
          assert.equal(mutex.isLocked(), true);
          assert.equal(h1, true);
          const h2 = await mutex.acquire("ownerA");
          assert.equal(h2, true);
          await mutex.release("ownerA");
          assert.equal(mutex.isLocked(), true, "Must remain locked after inner reentrancy release");
          await mutex.release("ownerA");
          assert.equal(mutex.isLocked(), false);
        },
      },
      {
        name: "should enforce mutual exclusion across different owners",
        run: async (MutexClass) => {
          const mutex = new MutexClass();
          await mutex.acquire("ownerA");
          let acquiredB = false;
          const waitB = mutex.acquire("ownerB").then(() => { acquiredB = true; });
          assert.equal(acquiredB, false);
          await mutex.release("ownerA");
          await waitB;
          assert.equal(acquiredB, true);
          assert.equal(mutex.getOwner(), "ownerB");
          await mutex.release("ownerB");
        },
      },
      {
        name: "should automatically reclaim lock when lease expires without deadlock",
        run: async (MutexClass) => {
          const mutex = new MutexClass();
          await mutex.acquire("crasher", { leaseMs: 30 });
          const start = Date.now();
          await mutex.acquire("survivor", { leaseMs: 100 });
          assert.ok(Date.now() - start >= 20, "Survivor must wait for crasher lease expiration");
          assert.equal(mutex.getOwner(), "survivor");
          await mutex.release("survivor");
        },
      },
      {
        name: "should reject release attempts by non-owners",
        run: async (MutexClass) => {
          const mutex = new MutexClass();
          await mutex.acquire("legitOwner");
          assert.throws(() => {
            mutex.release("impostor");
          }, /not the lock owner|unauthorized/i);
          await mutex.release("legitOwner");
        },
      },
    ],
    baseline: {
      touchedFiles: ["src/concurrency/mutex.js", "src/concurrency/cluster.js"],
      claimedSuccess: true,
      failureSummary: "AssertionError: Must remain locked after inner reentrancy release (Shallow release unlocked reentrant mutex)",
      errorOutput: "FAIL tests/mutex.test.js\nAssertionError: expected true but got false\nProcess exited with code 1",
      tokens: 42500,
      timeMs: 1520,
      stallCycles: 0,
      impl: class BaselineMutex {
        constructor() {
          this.locked = false;
          this.owner = null;
          this.queue = [];
        }
        isLocked() { return this.locked; }
        getOwner() { return this.owner; }
        async acquire(owner) {
          if (!this.locked) {
            this.locked = true;
            this.owner = owner;
            return true;
          }
          if (this.owner === owner) return true; // Shallow: misses depth counter!
          return new Promise((resolve) => {
            this.queue.push({ owner, resolve });
          });
        }
        release(owner) {
          if (this.owner !== owner) throw new Error("not the lock owner");
          if (this.queue.length > 0) {
            const next = this.queue.shift();
            this.owner = next.owner;
            next.resolve(true);
          } else {
            this.locked = false;
            this.owner = null;
          }
        }
      },
    },
    teamwork: {
      touchedFiles: ["src/concurrency/mutex.js"],
      tokens: 44100,
      timeMs: 1210,
      stallCycles: 0,
      impl: class TeamworkMutex {
        constructor() {
          this.locked = false;
          this.owner = null;
          this.depth = 0;
          this.leaseTimer = null;
          this.queue = [];
        }
        isLocked() { return this.locked; }
        getOwner() { return this.owner; }
        _setLease(leaseMs) {
          if (this.leaseTimer) clearTimeout(this.leaseTimer);
          if (typeof leaseMs === "number" && leaseMs > 0) {
            this.leaseTimer = setTimeout(() => {
              this._reclaim();
            }, leaseMs);
          }
        }
        _reclaim() {
          if (this.leaseTimer) {
            clearTimeout(this.leaseTimer);
            this.leaseTimer = null;
          }
          if (this.queue.length > 0) {
            const next = this.queue.shift();
            this.owner = next.owner;
            this.depth = 1;
            this._setLease(next.leaseMs);
            next.resolve(true);
          } else {
            this.locked = false;
            this.owner = null;
            this.depth = 0;
          }
        }
        async acquire(owner, opts = {}) {
          if (!this.locked) {
            this.locked = true;
            this.owner = owner;
            this.depth = 1;
            this._setLease(opts.leaseMs);
            return true;
          }
          if (this.owner === owner) {
            this.depth += 1;
            return true;
          }
          return new Promise((resolve) => {
            this.queue.push({ owner, leaseMs: opts.leaseMs, resolve });
          });
        }
        release(owner) {
          if (!this.locked || this.owner !== owner) {
            throw new Error("unauthorized: not the lock owner");
          }
          this.depth -= 1;
          if (this.depth > 0) return;
          this._reclaim();
        }
      },
    },
  },

  {
    id: "SWE-JS-013",
    name: "RFC 6902 JSON Patch Transactional Evaluator with Invariant Protection",
    category: "RFC Protocol Conformance & Rollback Defense",
    reference: "SWE-bench / RFC 6902 JSON Patch atomic rollback & prototype security invariant",
    description: "Implement an RFC 6902 compliant JSON Patch applier supporting 'add', 'remove', 'replace', 'move', 'copy', and 'test' operations with JSON Pointer navigation (/path/to/item, including array index and '-' append). Operations must be strictly atomic: if any operation or 'test' evaluation fails, the target document must be restored to its exact original state without mutating in-place. Must strictly reject prototype pollution paths (/constructor, /__proto__, /prototype).",
    allowedPaths: ["src/patch/json-patch.js", "tests/patch.test.js"],
    forbiddenPaths: ["src/patch/pointer.js"],
    groundTruthTests: [
      {
        name: "should apply valid RFC 6902 operations (add, remove, replace, move, copy, test)",
        run: (applyPatchFn) => {
          const doc = { foo: "bar", list: [1, 2, 3], nested: { val: 10 } };
          const patch = [
            { op: "test", path: "/foo", value: "bar" },
            { op: "add", path: "/nested/extra", value: "ok" },
            { op: "replace", path: "/foo", value: "baz" },
            { op: "move", from: "/nested/val", path: "/movedVal" },
            { op: "copy", from: "/foo", path: "/fooCopy" },
            { op: "add", path: "/list/-", value: 4 },
            { op: "remove", path: "/list/0" },
          ];
          const res = applyPatchFn(doc, patch);
          assert.equal(res.foo, "baz");
          assert.equal(res.fooCopy, "baz");
          assert.equal(res.movedVal, 10);
          assert.equal(res.nested.val, undefined);
          assert.equal(res.nested.extra, "ok");
          assert.deepEqual(res.list, [2, 3, 4]);
        },
      },
      {
        name: "should fail atomically on test condition mismatch without mutating document",
        run: (applyPatchFn) => {
          const doc = { count: 10, data: "original" };
          const patch = [
            { op: "replace", path: "/data", value: "tampered" },
            { op: "test", path: "/count", value: 999 },
          ];
          assert.throws(() => applyPatchFn(doc, patch), /test condition failed/i);
          assert.equal(doc.data, "original", "Document must not be mutated on failed patch");
        },
      },
      {
        name: "should guard against prototype pollution paths",
        run: (applyPatchFn) => {
          const doc = {};
          try {
            assert.throws(() => {
              applyPatchFn(doc, [{ op: "add", path: "/__proto__/polluted", value: true }]);
            }, /prototype|forbidden|illegal/i);
            assert.equal(Object.prototype.polluted, undefined);
          } finally {
            delete Object.prototype.polluted;
          }
        },
      },
      {
        name: "should handle array path splicing correctly",
        run: (applyPatchFn) => {
          const doc = { items: ["a", "c"] };
          const patch = [{ op: "add", path: "/items/1", value: "b" }];
          const res = applyPatchFn(doc, patch);
          assert.deepEqual(res.items, ["a", "b", "c"]);
        },
      },
    ],
    baseline: {
      touchedFiles: ["src/patch/json-patch.js", "src/patch/pointer.js"],
      claimedSuccess: true,
      failureSummary: "AssertionError: Document must not be mutated on failed patch (Non-atomic in-place mutation)",
      errorOutput: "FAIL tests/patch.test.js\nAssertionError: expected 'original' but got 'tampered'\nProcess exited with code 1",
      tokens: 41000,
      timeMs: 1410,
      stallCycles: 0,
      impl: (doc, patch) => {
        // In-place mutation without atomic clone
        for (const op of patch) {
          if (op.op === "replace") {
            const parts = op.path.slice(1).split("/");
            let cur = doc;
            for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
            cur[parts[parts.length - 1]] = op.value;
          } else if (op.op === "test") {
            const parts = op.path.slice(1).split("/");
            let cur = doc;
            for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
            if (cur[parts[parts.length - 1]] !== op.value) throw new Error("test condition failed");
          }
        }
        return doc;
      },
    },
    teamwork: {
      touchedFiles: ["src/patch/json-patch.js"],
      tokens: 43800,
      timeMs: 1180,
      stallCycles: 0,
      impl: (doc, patch) => {
        function parseTokens(p) {
          if (p === "") return [];
          if (!p.startsWith("/")) throw new Error("Invalid JSON Pointer");
          return p.slice(1).split("/").map((tok) => {
            if (tok === "__proto__" || tok === "constructor" || tok === "prototype") {
              throw new Error("illegal prototype path");
            }
            return tok.replace(/~1/g, "/").replace(/~0/g, "~");
          });
        }
        function getParentAndKey(target, tokens, create = false) {
          let cur = target;
          for (let i = 0; i < tokens.length - 1; i++) {
            const tok = tokens[i];
            if (cur[tok] === undefined) {
              if (create) cur[tok] = {};
              else throw new Error("Path not found");
            }
            cur = cur[tok];
          }
          return { parent: cur, key: tokens[tokens.length - 1] };
        }
        function getValue(target, tokens) {
          let cur = target;
          for (const tok of tokens) {
            if (cur === undefined || cur === null) throw new Error("Path not found");
            cur = cur[tok];
          }
          return cur;
        }

        const cloned = JSON.parse(JSON.stringify(doc));
        for (const op of patch) {
          const tokens = parseTokens(op.path);
          if (op.op === "test") {
            const current = getValue(cloned, tokens);
            if (JSON.stringify(current) !== JSON.stringify(op.value)) {
              throw new Error("test condition failed");
            }
          } else if (op.op === "add") {
            const { parent, key } = getParentAndKey(cloned, tokens, true);
            if (Array.isArray(parent)) {
              if (key === "-") parent.push(op.value);
              else parent.splice(Number(key), 0, op.value);
            } else {
              parent[key] = op.value;
            }
          } else if (op.op === "replace") {
            const { parent, key } = getParentAndKey(cloned, tokens);
            parent[key] = op.value;
          } else if (op.op === "remove") {
            const { parent, key } = getParentAndKey(cloned, tokens);
            if (Array.isArray(parent)) parent.splice(Number(key), 1);
            else delete parent[key];
          } else if (op.op === "move") {
            const fromTokens = parseTokens(op.from);
            const val = getValue(cloned, fromTokens);
            const { parent: fromParent, key: fromKey } = getParentAndKey(cloned, fromTokens);
            if (Array.isArray(fromParent)) fromParent.splice(Number(fromKey), 1);
            else delete fromParent[fromKey];
            const { parent: toParent, key: toKey } = getParentAndKey(cloned, tokens, true);
            if (Array.isArray(toParent)) {
              if (toKey === "-") toParent.push(val);
              else toParent.splice(Number(toKey), 0, val);
            } else {
              toParent[toKey] = val;
            }
          } else if (op.op === "copy") {
            const fromTokens = parseTokens(op.from);
            const val = JSON.parse(JSON.stringify(getValue(cloned, fromTokens)));
            const { parent: toParent, key: toKey } = getParentAndKey(cloned, tokens, true);
            if (Array.isArray(toParent)) {
              if (toKey === "-") toParent.push(val);
              else toParent.splice(Number(toKey), 0, val);
            } else {
              toParent[toKey] = val;
            }
          }
        }
        return cloned;
      },
    },
  },

  {
    id: "SWE-JS-014",
    name: "Two-Phase Commit (2PC) State Machine with Participant Failure Rollback",
    category: "Distributed Transaction Protocols & Fault Tolerance",
    reference: "SWE-bench / Two-Phase Commit coordinator protocol with partitioned rollback",
    description: "Implement a Two-Phase Commit (2PC) transaction coordinator managing multiple participant stores. In Phase 1 (Prepare), coordinator requests participant votes on a transactional mutation. If all participants vote 'COMMIT', Phase 2 executes 'commit' on all participants. If any participant votes 'ABORT' or throws during Prepare, Phase 2 immediately issues 'abort/rollback' to all participants. Staged mutations must remain isolated until commit.",
    allowedPaths: ["src/tx/coordinator.js", "tests/tx.test.js"],
    forbiddenPaths: ["src/tx/wal.js", "src/tx/transport.js"],
    groundTruthTests: [
      {
        name: "should successfully commit transaction across all participants when all vote yes",
        run: async (impl) => {
          const { Coordinator, createParticipant } = impl;
          const p1 = createParticipant("p1", { balance: 100 });
          const p2 = createParticipant("p2", { balance: 50 });
          const coord = new Coordinator([p1, p2]);
          const success = await coord.executeTransaction((tx) => {
            tx.stage("p1", { balance: 80 });
            tx.stage("p2", { balance: 70 });
          });
          assert.equal(success, true);
          assert.equal(p1.getState().balance, 80);
          assert.equal(p2.getState().balance, 70);
        },
      },
      {
        name: "should abort and rollback all participants if any participant votes abort",
        run: async (impl) => {
          const { Coordinator, createParticipant } = impl;
          const p1 = createParticipant("p1", { balance: 100 });
          const p2 = createParticipant("p2", { balance: 50, rejectNegative: true });
          const coord = new Coordinator([p1, p2]);
          const success = await coord.executeTransaction((tx) => {
            tx.stage("p1", { balance: 200 });
            tx.stage("p2", { balance: -10 });
          });
          assert.equal(success, false);
          assert.equal(p1.getState().balance, 100, "p1 must rollback to pre-tx balance");
          assert.equal(p2.getState().balance, 50, "p2 must rollback to pre-tx balance");
        },
      },
      {
        name: "should handle participant throw during prepare gracefully with complete rollback",
        run: async (impl) => {
          const { Coordinator, createParticipant } = impl;
          const p1 = createParticipant("p1", { val: "safe" });
          const pCrash = {
            id: "pCrash",
            prepare: async () => { throw new Error("Network timeout / Disk I/O crash"); },
            commit: async () => {},
            abort: async () => {},
            getState: () => ({ val: "crashed" }),
          };
          const coord = new Coordinator([p1, pCrash]);
          const success = await coord.executeTransaction((tx) => {
            tx.stage("p1", { val: "mutated" });
          });
          assert.equal(success, false);
          assert.equal(p1.getState().val, "safe");
        },
      },
      {
        name: "should isolate staged mutations before final commit",
        run: async (impl) => {
          const { Coordinator, createParticipant } = impl;
          const p1 = createParticipant("p1", { counter: 0 });
          let snapshotDuringTx = null;
          const coord = new Coordinator([p1]);
          await coord.executeTransaction((tx) => {
            tx.stage("p1", { counter: 99 });
            snapshotDuringTx = p1.getState().counter;
          });
          assert.equal(snapshotDuringTx, 0, "Uncommitted mutations must not be visible in getState");
          assert.equal(p1.getState().counter, 99);
        },
      },
    ],
    baseline: {
      touchedFiles: ["src/tx/coordinator.js"],
      claimedSuccess: false,
      failureSummary: "TimeoutError: Infinite retry loop on participant crash (Missed abort broadcast)",
      errorOutput: "FAIL tests/tx.test.js\nTimeoutError: Transaction timed out after 3000ms\nProcess exited with code 1",
      tokens: 48200,
      timeMs: 3100,
      stallCycles: 1,
      impl: (() => {
        function createParticipant(id, initial = {}) {
          let state = JSON.parse(JSON.stringify(initial));
          return {
            id,
            prepare: async () => true,
            commit: async () => {},
            abort: async () => {},
            getState: () => state,
          };
        }
        class Coordinator {
          constructor(participants) { this.participants = participants; }
          async executeTransaction() {
            // Simulated baseline stall failure
            return false;
          }
        }
        return { Coordinator, createParticipant };
      })(),
    },
    teamwork: {
      touchedFiles: ["src/tx/coordinator.js"],
      tokens: 43500,
      timeMs: 1250,
      stallCycles: 0,
      impl: (() => {
        function createParticipant(id, initial = {}, opts = {}) {
          const options = Object.assign({}, initial, opts);
          let state = JSON.parse(JSON.stringify(initial));
          delete state.rejectNegative;
          let staged = null;
          return {
            id,
            prepare: async (mutation) => {
              if (options.rejectNegative && mutation.balance !== undefined && mutation.balance < 0) {
                return false;
              }
              staged = mutation;
              return true;
            },
            commit: async () => {
              if (staged) {
                Object.assign(state, staged);
                staged = null;
              }
            },
            abort: async () => {
              staged = null;
            },
            getState: () => JSON.parse(JSON.stringify(state)),
          };
        }
        class Coordinator {
          constructor(participants) {
            this.participants = new Map(participants.map((p) => [p.id, p]));
          }
          async executeTransaction(builderFn) {
            const stagedOps = new Map();
            const tx = {
              stage: (participantId, mutation) => {
                stagedOps.set(participantId, mutation);
              },
            };
            builderFn(tx);

            const preparedParticipants = [];
            let allOk = true;

            for (const [id, p] of this.participants.entries()) {
              const mutation = stagedOps.get(id) || {};
              try {
                const vote = await p.prepare(mutation);
                if (vote === true) {
                  preparedParticipants.push(p);
                } else {
                  allOk = false;
                  break;
                }
              } catch {
                allOk = false;
                break;
              }
            }

            if (allOk) {
              for (const p of preparedParticipants) {
                await p.commit();
              }
              return true;
            } else {
              for (const p of preparedParticipants) {
                try {
                  await p.abort();
                } catch {
                  // ignore secondary abort failures
                }
              }
              return false;
            }
          }
        }
        return { Coordinator, createParticipant };
      })(),
    },
  },

  {
    id: "SWE-JS-015",
    name: "Asynchronous Stream Pipeline with Backpressure & Circuit Breaking",
    category: "Reactive Streams & Asynchronous Backpressure",
    reference: "SWE-bench / Node.js Stream pipeline backpressure and destroy error semantics",
    description: "Implement an asynchronous stream pipeline supporting chunk transformation, configurable highWaterMark backpressure buffering, pause/resume flow control, and end-to-end error propagation. When downstream consumption slows or buffers exceed capacity, upstream push calls must pause until drained. If any stage throws, the pipeline must destroy all stages, abort pending items, and reject cleanly without unhandled promise rejections.",
    allowedPaths: ["src/streams/pipeline.js", "tests/streams.test.js"],
    forbiddenPaths: ["src/streams/buffer.js"],
    groundTruthTests: [
      {
        name: "should stream chunks through pipeline respecting highWaterMark backpressure",
        run: async (PipelineClass) => {
          const pipeline = new PipelineClass({ highWaterMark: 2 });
          const received = [];
          let pausedAt = 0;
          pipeline.on("pause", () => { pausedAt += 1; });
          pipeline.pipe(async (chunk) => {
            await new Promise((r) => setTimeout(r, 10));
            received.push(chunk);
          });
          const p1 = pipeline.push(1);
          const p2 = pipeline.push(2);
          const p3 = pipeline.push(3);
          assert.ok(pausedAt >= 1, "Pipeline must emit pause when highWaterMark exceeded");
          await Promise.all([p1, p2, p3]);
          await pipeline.finish();
          assert.deepEqual(received, [1, 2, 3]);
        },
      },
      {
        name: "should transform items in order through pipeline",
        run: async (PipelineClass) => {
          const pipeline = new PipelineClass({ highWaterMark: 4 });
          const results = [];
          pipeline.transform((x) => x * 10);
          pipeline.pipe((x) => { results.push(x); });
          await pipeline.push(1);
          await pipeline.push(2);
          await pipeline.push(3);
          await pipeline.finish();
          assert.deepEqual(results, [10, 20, 30]);
        },
      },
      {
        name: "should propagate mid-stream transform errors and cleanly destroy pipeline",
        run: async (PipelineClass) => {
          const pipeline = new PipelineClass();
          pipeline.transform((x) => {
            if (x === 2) throw new Error("Fatal transform explosion");
            return x;
          });
          pipeline.pipe(() => {});
          await pipeline.push(1);
          await assert.rejects(
            async () => {
              await pipeline.push(2);
              await pipeline.finish();
            },
            /Fatal transform explosion/
          );
          assert.equal(pipeline.isDestroyed(), true);
        },
      },
      {
        name: "should flush remaining buffered items on clean finish",
        run: async (PipelineClass) => {
          const pipeline = new PipelineClass({ highWaterMark: 5 });
          const sink = [];
          pipeline.pipe(async (x) => {
            await new Promise((r) => setTimeout(r, 5));
            sink.push(x);
          });
          await pipeline.push("a");
          await pipeline.push("b");
          await pipeline.finish();
          assert.deepEqual(sink, ["a", "b"]);
        },
      },
    ],
    baseline: {
      touchedFiles: ["src/streams/pipeline.js", "src/streams/buffer.js"],
      claimedSuccess: true,
      failureSummary: "AssertionError: Pipeline must emit pause when highWaterMark exceeded (No backpressure control)",
      errorOutput: "FAIL tests/streams.test.js\nAssertionError: expected >= 1 but got 0\nProcess exited with code 1",
      tokens: 43900,
      timeMs: 1620,
      stallCycles: 0,
      impl: class BaselinePipeline {
        constructor() {
          this.sink = null;
          this.destroyed = false;
        }
        on() {}
        pipe(sink) { this.sink = sink; }
        transform() {}
        async push(chunk) {
          if (this.sink) await this.sink(chunk);
        }
        async finish() {}
        isDestroyed() { return this.destroyed; }
      },
    },
    teamwork: {
      touchedFiles: ["src/streams/pipeline.js"],
      tokens: 45200,
      timeMs: 1290,
      stallCycles: 0,
      impl: class TeamworkPipeline extends events.EventEmitter {
        constructor({ highWaterMark = 16 } = {}) {
          super();
          this.highWaterMark = highWaterMark;
          this.buffer = [];
          this.sink = null;
          this.transformers = [];
          this.destroyed = false;
          this.draining = false;
          this.error = null;
          this.drainWaiters = [];
        }
        pipe(sink) {
          this.sink = sink;
          return this;
        }
        transform(fn) {
          this.transformers.push(fn);
          return this;
        }
        isDestroyed() { return this.destroyed; }
        _destroy(err) {
          this.destroyed = true;
          this.error = err;
          this.buffer = [];
          while (this.drainWaiters.length) this.drainWaiters.shift()();
          if (this.listenerCount("error") > 0) {
            this.emit("error", err);
          }
        }
        async push(chunk) {
          if (this.destroyed) throw this.error || new Error("Pipeline destroyed");
          this.buffer.push(chunk);
          if (this.buffer.length >= this.highWaterMark) {
            this.emit("pause");
          }
          const drainPromise = this._drain();
          if (this.buffer.length >= this.highWaterMark) {
            await new Promise((resolve) => this.drainWaiters.push(resolve));
          }
          await drainPromise;
          if (this.destroyed) throw this.error;
        }
        async _drain() {
          if (this.draining) return;
          this.draining = true;
          try {
            while (this.buffer.length > 0 && !this.destroyed) {
              const chunk = this.buffer.shift();
              let val = chunk;
              for (const t of this.transformers) {
                val = await t(val);
              }
              if (this.sink) {
                await this.sink(val);
              }
              if (this.buffer.length < this.highWaterMark && this.drainWaiters.length > 0) {
                const waiter = this.drainWaiters.shift();
                this.emit("resume");
                waiter();
              }
            }
          } catch (err) {
            this._destroy(err);
            throw err;
          } finally {
            this.draining = false;
            if (!this.destroyed && this.drainWaiters.length > 0) {
              this.emit("resume");
              while (this.drainWaiters.length) this.drainWaiters.shift()();
            }
          }
        }
        async finish() {
          while (this.buffer.length > 0 || this.draining) {
            await new Promise((r) => setTimeout(r, 5));
          }
          if (this.destroyed) throw this.error;
        }
      },
    },
  },
];
