#!/usr/bin/env node

import puppeteer from "puppeteer-core";

const DEFAULT_CONNECT_BASE = "https://cloudbrowser.gologin.com/connect";
const GOLOGIN_API_BASE = "https://api.gologin.com";

const token = process.env.GOLOGIN_TOKEN?.trim();
const profileIdFromEnv = process.env.GOLOGIN_PROFILE_ID?.trim();
const connectBase = process.env.GOLOGIN_CONNECT_BASE?.trim() || DEFAULT_CONNECT_BASE;

let createdProfileId = undefined;
let browser;

function fail(message) {
  throw new Error(message);
}

function readableConnectFailure(status, reason) {
  const suffix = reason ? `: ${reason}` : "";

  if (status === 403) {
    return `GoLogin rejected the Cloud Browser start (403)${suffix}. Check GOLOGIN_TOKEN and profile access.`;
  }

  if (status === 503) {
    return `GoLogin could not start the Cloud Browser (503)${suffix}. This usually means temporary capacity or launch backend issues.`;
  }

  return `GoLogin Cloud Browser preflight failed with status ${status}${suffix}.`;
}

function toBrowserWebSocketUrl(connectUrl) {
  const url = new URL(connectUrl);

  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  }

  return url.toString();
}

async function createTemporaryProfile() {
  const response = await fetch(`${GOLOGIN_API_BASE}/browser/quick`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: `puppeteer-cloud-browser-${Date.now()}`,
      os: "lin"
    })
  });

  if (!response.ok) {
    let reason = "";
    try {
      reason = await response.text();
    } catch {
      reason = "";
    }

    fail(`Profile creation failed (${response.status}): ${reason || "GoLogin rejected the temporary profile request."}`);
  }

  const payload = await response.json();
  const profileId = payload?.id ?? payload?._id;

  if (!profileId) {
    fail("Profile creation failed: GoLogin returned no profile id.");
  }

  return profileId;
}

async function preflightCloudConnect(connectUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(connectUrl, {
      method: "GET",
      signal: controller.signal
    });

    if (!response.ok) {
      const reasonHeader = response.headers.get("x-error-reason") ?? response.headers.get("X-Error-Reason");
      let reasonText = "";
      try {
        reasonText = await response.text();
      } catch {
        reasonText = "";
      }

      const reason = reasonHeader || reasonText;
      fail(readableConnectFailure(response.status, reason));
    }
  } catch (error) {
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      // Best-effort preflight. The repo treats the HTTP probe as diagnostics only when it itself fails.
      return;
    }

    if (error instanceof Error && /fetch/i.test(error.message)) {
      // Best-effort preflight. The repo allows the CDP path to continue.
      return;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function deleteProfile(profileId) {
  const response = await fetch(`${GOLOGIN_API_BASE}/browser/${profileId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    console.warn(`Warning: could not delete temporary profile ${profileId} (${response.status}).`);
  }
}

try {
  if (!token) {
    fail("GOLOGIN_TOKEN is required. Export it before running this example.");
  }

  const profileId = profileIdFromEnv || (await createTemporaryProfile());
  if (!profileIdFromEnv) {
    createdProfileId = profileId;
  }

  const connectUrl = new URL(connectBase);
  connectUrl.searchParams.set("token", token);
  if (profileId) {
    connectUrl.searchParams.set("profile", profileId);
  }

  await preflightCloudConnect(connectUrl.toString());

  const browserWSEndpoint = toBrowserWebSocketUrl(connectUrl.toString());
  browser = await puppeteer.connect({
    browserWSEndpoint,
    protocolTimeout: 30_000,
    defaultViewport: null
  });

  console.log("Connected to GoLogin Cloud Browser");

  const page = (await browser.pages()).at(0) ?? (await browser.newPage());
  await page.goto("https://example.com", {
    waitUntil: "domcontentloaded",
    timeout: 30_000
  });

  const title = await page.title();
  console.log(`Page title: ${title}`);
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
} finally {
  if (browser) {
    try {
      await browser.disconnect();
    } catch (cleanupError) {
      console.warn("Warning: browser disconnect failed.");
      if (cleanupError instanceof Error) {
        console.warn(cleanupError.message);
      }
    }
  }

  if (createdProfileId) {
    try {
      await deleteProfile(createdProfileId);
    } catch (cleanupError) {
      console.warn(`Warning: cleanup for temporary profile ${createdProfileId} failed.`);
      if (cleanupError instanceof Error) {
        console.warn(cleanupError.message);
      }
    }
  }

  if (!process.exitCode) {
    console.log("Disconnected");
  }
}
