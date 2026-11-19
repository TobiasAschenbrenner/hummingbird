import assert from "node:assert/strict";
import { test } from "node:test";
import { activateRelease, verifiedRevision, verifyRelease } from "./deploy.mjs";

const revision = "a".repeat(40);
const successfulRun = {
  head_sha: revision,
  head_branch: "main",
  event: "push",
  head_repository: { full_name: "TobiasAschenbrenner/hummingbird" },
  path: ".github/workflows/checks.yml",
  status: "completed",
  conclusion: "success",
};

test("deployment requires successful push checks for the exact current main commit", () => {
  assert.equal(verifiedRevision(revision, successfulRun), revision);
  for (const run of [
    undefined,
    { ...successfulRun, status: "in_progress", conclusion: null },
    { ...successfulRun, conclusion: "failure" },
    { ...successfulRun, conclusion: "cancelled" },
    { ...successfulRun, head_sha: "b".repeat(40) },
    { ...successfulRun, head_branch: "feature" },
    { ...successfulRun, event: "pull_request" },
    { ...successfulRun, head_repository: { full_name: "someone/fork" } },
    { ...successfulRun, path: ".github/workflows/another.yml" },
  ])
    assert.equal(verifiedRevision(revision, run), null);
  assert.equal(
    verifiedRevision("../outside", {
      ...successfulRun,
      head_sha: "../outside",
    }),
    null,
  );
});

test("activation keeps the new release only after a restart and health verification", async () => {
  const events = [];
  await activateRelease("new", "previous", {
    switchTo: (release) => events.push(release),
    restart: () => events.push("restart"),
    verify: async () => events.push("verify"),
  });
  assert.deepEqual(events, ["new", "restart", "verify"]);
});

test("failed restarts and failed health checks both restore and restart the previous release", async () => {
  for (const failure of ["restart", "verify"]) {
    const events = [];
    await assert.rejects(
      activateRelease("new", "previous", {
        switchTo: (release) => events.push(release),
        restart() {
          events.push("restart");
          if (failure === "restart" && events.length === 2)
            throw new Error("Startup failed.");
        },
        async verify() {
          throw new Error("Health check failed.");
        },
      }),
      /previous release was restored/,
    );
    assert.deepEqual(events, ["new", "restart", "previous", "restart"]);
  }
});

function publicResponse(url) {
  const path = new URL(url).pathname;
  if (path === "/release.json") return Response.json({ commit: revision });
  if (path === "/api/health") return Response.json({ status: "ok" });
  if (path === "/api/articles")
    return Response.json({
      articles: [{ slug: "demo" }],
      pagination: { total: 1 },
    });
  if (path === "/api/articles/demo")
    return Response.json({ article: { slug: "demo" } });
  if (path.endsWith(".js")) return new Response('console.log("app");');
  return new Response(
    '<app-root></app-root><script src="main-ABC123.js"></script>',
  );
}

test("health verification checks the version, database reads, frontend bundle and refreshed article URL", async () => {
  const requested = [];
  await verifyRelease(revision, "http://127.0.0.1:3100", async (url) => {
    requested.push(new URL(url).pathname);
    return publicResponse(url);
  });
  assert.ok(requested.includes("/main-ABC123.js"));
  assert.ok(requested.includes("/api/articles/demo"));
  assert.ok(requested.includes("/articles/demo"));
});

test("a stale release, broken database response or unavailable bundle cannot pass health checks", async () => {
  for (const path of ["/release.json", "/api/articles", "/main-ABC123.js"]) {
    await assert.rejects(
      verifyRelease(revision, "http://127.0.0.1:3100", async (url) => {
        if (new URL(url).pathname !== path) return publicResponse(url);
        if (path === "/release.json")
          return Response.json({ commit: "b".repeat(40) });
        if (path === "/api/articles")
          return Response.json({ error: "Database unavailable." });
        return new Response("Missing bundle.", { status: 404 });
      }),
    );
  }
});
