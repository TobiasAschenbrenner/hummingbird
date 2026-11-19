import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const repository = "TobiasAschenbrenner/hummingbird";
const application = "/srv/hummingbird";
const nodeDirectory = "/opt/hummingbird/node/bin";

export function verifiedRevision(head, run) {
  return /^[a-f0-9]{40}$/.test(head) &&
    run?.head_sha === head &&
    run.head_branch === "main" &&
    run.event === "push" &&
    run.head_repository?.full_name === repository &&
    run.path === ".github/workflows/checks.yml" &&
    run.status === "completed" &&
    run.conclusion === "success"
    ? head
    : null;
}

async function github(path) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/${path}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "hummingbird-deploy",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok)
    throw new Error(`GitHub release check returned HTTP ${response.status}.`);
  return response.json();
}

export async function verifyRelease(revision, baseUrl, request = fetch) {
  async function read(path, json = true) {
    const response = await request(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Release check failed for ${path}.`);
    return json ? response.json() : response.text();
  }
  const [release, health, page, html] = await Promise.all([
    read(`/release.json?commit=${revision}`),
    read("/api/health"),
    read("/api/articles?page=1&pageSize=1"),
    read("/", false),
  ]);
  if (
    release.commit !== revision ||
    health.status !== "ok" ||
    !Array.isArray(page.articles) ||
    !Number.isInteger(page.pagination?.total) ||
    !html.includes("<app-root")
  ) {
    throw new Error(
      "The new release failed its version, API or frontend checks.",
    );
  }
  const script = html.match(/src="([^"\s]+\.js)"/)?.[1];
  if (
    !script ||
    script.startsWith("/") ||
    script.includes("..") ||
    new URL(script, `${baseUrl}/`).origin !== new URL(baseUrl).origin
  ) {
    throw new Error("The frontend JavaScript bundle is missing or invalid.");
  }
  await read(`/${script}`, false);
  if (page.articles.length) {
    const slug = page.articles[0].slug;
    if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      throw new Error("Invalid public article slug.");
    const detail = await read(`/api/articles/${slug}`);
    if (detail.article?.slug !== slug)
      throw new Error("Article detail verification failed.");
    const refreshed = await read(`/articles/${slug}`, false);
    if (!refreshed.includes("<app-root"))
      throw new Error("Article URL refresh failed.");
  }
}

export async function activateRelease(release, previous, operations) {
  operations.switchTo(release);
  try {
    operations.restart();
    await operations.verify();
  } catch (error) {
    operations.switchTo(previous);
    operations.restart();
    throw new Error(
      "The new release failed its health check; the previous release was restored.",
      { cause: error },
    );
  }
}

function run(command, args, cwd = application) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    timeout: 600_000,
  });
  if (result.error || result.status !== 0)
    throw new Error(`Deployment command failed: ${command}.`);
}

function switchTo(release) {
  const temporaryLink = join(application, `.current-${process.pid}`);
  symlinkSync(release, temporaryLink);
  renameSync(temporaryLink, join(application, "current"));
}

async function deploy() {
  if (process.getuid() !== 0)
    throw new Error("Run deployments through hummingbird-deploy.service.");
  const previous = resolve(
    application,
    readlinkSync(join(application, "current")),
  );
  const head = (await github("commits/main")).sha;
  if (basename(previous).split("-")[0] === head) return;
  const runs = await github(
    "actions/workflows/checks.yml/runs?branch=main&event=push&per_page=1",
  );
  const revision = verifiedRevision(head, runs.workflow_runs?.[0]);
  if (!revision) {
    console.log(
      "Keeping the current release while main awaits successful checks.",
    );
    return;
  }

  const staging = mkdtempSync(join(application, "releases/.build-"));
  try {
    run("chown", ["hummingbird:hummingbird", staging]);
    buildRelease(revision, staging);
    if ((await github("commits/main")).sha !== revision) {
      console.log(
        "A newer commit reached main during the build; keeping the current release.",
      );
      return;
    }
    run(
      "runuser",
      [
        "-u",
        "hummingbird",
        "--",
        "/bin/bash",
        "-c",
        `
      set -euo pipefail
      export PATH=${nodeDirectory}:/usr/local/bin:/usr/bin:/bin
      set -a
      . /etc/hummingbird/hummingbird.env
      set +a
      npm run db:deploy
    `,
      ],
      staging,
    );
    const release = join(application, "releases", `${revision}-${Date.now()}`);
    renameSync(staging, release);
    await activateRelease(release, previous, {
      switchTo,
      restart: () => run("systemctl", ["restart", "hummingbird.service"]),
      async verify() {
        for (let attempt = 0; attempt < 30; attempt++) {
          try {
            await verifyRelease(revision, "http://127.0.0.1:3100");
            return;
          } catch (error) {
            if (attempt === 29) throw error;
            await delay(1_000);
          }
        }
      },
    });
    console.log(
      `Deployed ${revision}. Frontend, article API and release checks passed.`,
    );
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

// Repository code, npm hooks and migrations run only as the application user.
function buildRelease(revision, staging) {
  run("runuser", [
    "-u",
    "hummingbird",
    "--",
    "/bin/bash",
    "-c",
    `
    set -euo pipefail
    export PATH=${nodeDirectory}:/usr/local/bin:/usr/bin:/bin
    export npm_config_cache=/srv/hummingbird/.npm-cache
    export NODE_ENV=production
    cd "$1"
    curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --max-time 120 "https://codeload.github.com/${repository}/tar.gz/$2" -o source.tar.gz
    tar --extract --gzip --strip-components=1 --no-same-owner --no-same-permissions --file source.tar.gz
    rm source.tar.gz
    npm ci
    npm run build
    printf '{"commit":"%s"}\\n' "$2" > client/dist/hummingbird-client/browser/release.json
  `,
    "hummingbird-build",
    staging,
    revision,
  ]);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  deploy().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
