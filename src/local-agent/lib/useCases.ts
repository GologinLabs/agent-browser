import { AppError } from "./errors";
import type {
  DoctorUseCaseCheck,
  DoctorUseCaseReport,
  ProfileCreateRequest,
  ProfileProxyCheck,
  ProfileUpdateRequest,
  SupportedUseCase
} from "./types";

type UseCaseInput = SupportedUseCase | "facebook";
type ProxyImportance = "required" | "recommended" | "optional";

type UseCaseDefinition = {
  useCase: SupportedUseCase;
  aliases: string[];
  summary: string;
  platform: string;
  status: string;
  tags: string[];
  createNotes: string;
  recommendedProxyStrategy: string;
  proxyImportance: ProxyImportance;
  missingProxyCheckStatus: DoctorUseCaseCheck["status"];
  prefersPersistentProfile: boolean;
  visibleFirstStepRecommended: boolean;
  nextSteps: string[];
};

const useCaseDefinitions: Record<SupportedUseCase, UseCaseDefinition> = {
  linkedin: {
    useCase: "linkedin",
    aliases: [],
    summary: "Persistent LinkedIn leadgen or recruiter profile with short warmup loops and clean proxy alignment.",
    platform: "linkedin",
    status: "warmup",
    tags: ["leadgen", "linkedin", "persistent-session"],
    createNotes:
      "LinkedIn leadgen template. Prefer one person per profile, a country-matched proxy, and short warmup cycles before unattended automation.",
    recommendedProxyStrategy: "Use a stable country-matched proxy before first login. GoLogin country proxy is the fastest default if no custom pool is ready.",
    proxyImportance: "recommended",
    missingProxyCheckStatus: "warn",
    prefersPersistentProfile: true,
    visibleFirstStepRecommended: true,
    nextSteps: [
      "profile-create <name> --template linkedin --proxy-country <cc>",
      "doctor --use-case linkedin --check-proxy <profileId>",
      "run ./examples/runbook-warmup.json --profile <profileId> --repeat 4 --pause-min-ms 30000 --pause-max-ms 120000"
    ]
  },
  ads: {
    useCase: "ads",
    aliases: ["facebook"],
    summary: "Dedicated ads operator profile with strong account isolation, stable proxy setup, and low-profile warmup.",
    platform: "facebook-ads",
    status: "warmup",
    tags: ["account-isolation", "ads", "facebook"],
    createNotes:
      "Ads operator template. Keep one profile per ad account or buyer identity, attach proxy before first login, and avoid sharing a hot profile across unrelated accounts.",
    recommendedProxyStrategy: "Use one stable proxy per account. Country-match the market whenever geo matters. Prefer explicit proxy review before login.",
    proxyImportance: "required",
    missingProxyCheckStatus: "warn",
    prefersPersistentProfile: true,
    visibleFirstStepRecommended: true,
    nextSteps: [
      "profile-create <name> --template ads --proxy-country <cc>",
      "doctor --use-case ads --check-proxy <profileId>",
      "open https://business.facebook.com --profile <profileId> --visible"
    ]
  },
  smm: {
    useCase: "smm",
    aliases: [],
    summary: "Persistent social-media profile optimized for shared access, handoffs, and stable cookies or storage state.",
    platform: "smm",
    status: "active",
    tags: ["handoff", "shared-access", "smm"],
    createNotes:
      "SMM template. Prefer one profile per brand or persona, keep handoff notes current, and export cookies or storage deliberately when another operator needs access.",
    recommendedProxyStrategy: "Use a stable proxy when the account geo matters. No proxy can be acceptable for low-risk internal review flows, but decide it explicitly.",
    proxyImportance: "recommended",
    missingProxyCheckStatus: "info",
    prefersPersistentProfile: true,
    visibleFirstStepRecommended: true,
    nextSteps: [
      "profile-create <name> --template smm [--proxy-country <cc>]",
      "doctor --use-case smm --check-proxy <profileId>",
      "cookies --session <sessionId> --json or storage-export <path> after login when a handoff artifact is needed"
    ]
  },
  scraping: {
    useCase: "scraping",
    aliases: [],
    summary: "Automation-oriented local profile for repeated rendered scraping, cookie reuse, or blocked targets that need a persistent browser identity.",
    platform: "scraping",
    status: "automation",
    tags: ["automation", "scraping", "session-reuse"],
    createNotes:
      "Scraping template. Prefer headless or background runs, retryable runbooks, and persistent cookies only when the target benefits from session reuse.",
    recommendedProxyStrategy: "Proxy is optional. Add one for geo-sensitive or blocked targets, otherwise keep the setup simple and deterministic.",
    proxyImportance: "optional",
    missingProxyCheckStatus: "info",
    prefersPersistentProfile: false,
    visibleFirstStepRecommended: false,
    nextSteps: [
      "profile-create <name> --template scraping",
      "doctor --use-case scraping [--check-proxy <profileId>]",
      "run ./examples/runbook-warmup.json --profile <profileId> --repeat 2 --pause-min-ms 10000 --pause-max-ms 30000"
    ]
  },
  geo: {
    useCase: "geo",
    aliases: [],
    summary: "Geo testing or local-market QA profile where proxy country, timezone, and browser state should align before capture or validation.",
    platform: "geo-testing",
    status: "testing",
    tags: ["geo", "market-check", "testing"],
    createNotes:
      "Geo testing template. Match the proxy country to the target market and verify the profile environment before screenshots, QA, or compliance checks.",
    recommendedProxyStrategy: "Proxy is mandatory. Match proxy country to the target market and verify it with doctor before any browsing or capture.",
    proxyImportance: "required",
    missingProxyCheckStatus: "warn",
    prefersPersistentProfile: true,
    visibleFirstStepRecommended: true,
    nextSteps: [
      "profile-create <name> --template geo --proxy-country <cc>",
      "doctor --use-case geo --check-proxy <profileId>",
      "open <target-url> --profile <profileId> --visible"
    ]
  }
};

function normalizeUseCase(value: string | undefined): UseCaseInput | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  return normalized as UseCaseInput;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

export function supportedUseCaseChoices(): string {
  return "linkedin|ads|facebook|smm|scraping|geo";
}

export function parseSupportedUseCase(value: string | undefined, flagName: string): SupportedUseCase | undefined {
  const normalized = normalizeUseCase(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized === "facebook") {
    return "ads";
  }

  if (normalized in useCaseDefinitions) {
    return normalized as SupportedUseCase;
  }

  throw new AppError("BAD_REQUEST", `${flagName} must be one of ${supportedUseCaseChoices()}`, 400);
}

export function getUseCaseDefinition(useCase: SupportedUseCase): UseCaseDefinition {
  return useCaseDefinitions[useCase];
}

export function applyProfileCreateTemplate(
  request: ProfileCreateRequest,
  useCase: SupportedUseCase | undefined
): ProfileCreateRequest {
  if (!useCase) {
    return request;
  }

  const definition = getUseCaseDefinition(useCase);
  return {
    ...request,
    platform: request.platform ?? definition.platform,
    status: request.status ?? definition.status,
    notes: request.notes ?? definition.createNotes,
    tags: uniqueSorted([...(definition.tags ?? []), ...(request.tags ?? [])])
  };
}

export function applyProfileUpdateTemplate(
  request: ProfileUpdateRequest,
  useCase: SupportedUseCase | undefined
): ProfileUpdateRequest {
  if (!useCase) {
    return request;
  }

  const definition = getUseCaseDefinition(useCase);
  return {
    ...request,
    platform: request.platform ?? definition.platform,
    status: request.status ?? definition.status,
    tags: request.tags ? uniqueSorted([...definition.tags, ...request.tags]) : request.tags,
    addTags: request.tags ? request.addTags : uniqueSorted([...(definition.tags ?? []), ...(request.addTags ?? [])])
  };
}

function buildProxyCheckMessage(useCase: UseCaseDefinition, proxyCheck: ProfileProxyCheck): DoctorUseCaseCheck {
  const labels = `${proxyCheck.localProxyLabel} / ${proxyCheck.remoteProxyLabel}`;

  if (proxyCheck.status === "mismatch" || proxyCheck.status === "local-only" || proxyCheck.status === "remote-only") {
    return {
      key: "proxy",
      status: "warn",
      message: proxyCheck.warning ?? `Proxy state is not aligned for ${useCase.useCase}: ${labels}`
    };
  }

  if (proxyCheck.status === "unavailable") {
    return {
      key: "proxy",
      status: useCase.missingProxyCheckStatus,
      message: proxyCheck.warning ?? `Proxy state could not be verified for ${useCase.useCase}`
    };
  }

  if (proxyCheck.localProxyLabel === "none" && proxyCheck.remoteProxyLabel === "none") {
    return {
      key: "proxy",
      status: useCase.proxyImportance === "optional" ? "info" : "warn",
      message:
        useCase.proxyImportance === "optional"
          ? "No proxy is attached. That is acceptable for low-risk local scraping, but add one for geo-sensitive or blocked targets."
          : `No proxy is attached. ${useCase.recommendedProxyStrategy}`
    };
  }

  return {
    key: "proxy",
    status: "ok",
    message: `Proxy check is aligned: local=${proxyCheck.localProxyLabel} remote=${proxyCheck.remoteProxyLabel}`
  };
}

export function buildDoctorUseCaseReport(input: {
  useCase: SupportedUseCase;
  tokenConfigured: boolean;
  executablePathExists: boolean;
  defaultProfileId?: string;
  headless: boolean;
  proxyCheck?: ProfileProxyCheck;
}): DoctorUseCaseReport {
  const definition = getUseCaseDefinition(input.useCase);
  const checks: DoctorUseCaseCheck[] = [
    {
      key: "token",
      status: input.tokenConfigured ? "ok" : "warn",
      message: input.tokenConfigured
        ? "GOLOGIN_TOKEN is configured for profile and runtime operations."
        : "GOLOGIN_TOKEN is missing. Local GoLogin profile work cannot start until it is configured."
    },
    {
      key: "orbita",
      status: input.executablePathExists ? "ok" : "warn",
      message: input.executablePathExists
        ? "Orbita executable was resolved successfully."
        : "Orbita executable was not resolved. Run doctor before launch troubleshooting or set GOLOGIN_EXECUTABLE_PATH."
    }
  ];

  if (definition.prefersPersistentProfile) {
    checks.push({
      key: "profile",
      status: input.defaultProfileId ? "ok" : "warn",
      message: input.defaultProfileId
        ? `Default profile is configured (${input.defaultProfileId}).`
        : "No default profile is configured. Use GOLOGIN_PROFILE_ID or pass --profile explicitly for repeated sessions."
    });
  } else {
    checks.push({
      key: "profile",
      status: "info",
      message:
        input.defaultProfileId
          ? `Default profile is configured (${input.defaultProfileId}), but scraping-focused runs can also use explicit one-off profiles.`
          : "Default profile is optional for scraping-focused local runs."
    });
  }

  if (input.proxyCheck) {
    checks.push(buildProxyCheckMessage(definition, input.proxyCheck));
  } else {
    checks.push({
      key: "proxy",
      status: definition.missingProxyCheckStatus,
      message:
        definition.proxyImportance === "optional"
          ? "No profile proxy was checked. Add --check-proxy <profileId> when the target becomes geo-sensitive or blocked."
          : `No profile proxy was checked. Run doctor --use-case ${definition.useCase} --check-proxy <profileId> before login or warmup.`
    });
  }

  checks.push({
    key: "visibility",
    status: "info",
    message:
      definition.visibleFirstStepRecommended && input.headless
        ? "GOLOGIN_HEADLESS=true. Use --visible for the first login, manual checkpoint, or warmup review before switching back to unattended mode."
        : !definition.visibleFirstStepRecommended && !input.headless
          ? "Visible mode is fine, but unattended scraping profiles usually run more predictably with --headless or GOLOGIN_HEADLESS=true."
          : definition.visibleFirstStepRecommended
            ? "Visible mode is recommended for the first login or warmup checkpoint."
            : "Headless or background mode is the normal default for this use case."
  });

  return {
    useCase: definition.useCase,
    summary: definition.summary,
    preferredRuntime: "local-profile",
    recommendedProxyStrategy: definition.recommendedProxyStrategy,
    checks,
    nextSteps: definition.nextSteps
  };
}
