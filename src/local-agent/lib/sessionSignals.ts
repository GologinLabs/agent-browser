import type { ErrorCode } from "./errors";

export interface ChallengeSignal {
  reason: string;
  matchedText?: string;
}

const CHALLENGE_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  { reason: "captcha", pattern: /\bcaptcha\b/i },
  { reason: "human verification", pattern: /verify (you('| a)?re|that you are) human/i },
  { reason: "security challenge", pattern: /\bchallenge\b/i },
  { reason: "access denied", pattern: /access denied|request blocked|forbidden/i },
  { reason: "bot protection", pattern: /unusual traffic|robot check|automated queries|security check/i }
];

const TERMINAL_SESSION_ERRORS = new Set<ErrorCode>([
  "SESSION_NOT_FOUND",
  "SESSION_EXPIRED",
  "SESSION_LOST",
  "CHALLENGE_DETECTED"
]);

export function detectChallengeSignal(input: {
  url?: string;
  title?: string;
  text?: string;
}): ChallengeSignal | undefined {
  const haystack = [input.url, input.title, input.text]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");

  if (!haystack) {
    return undefined;
  }

  for (const candidate of CHALLENGE_PATTERNS) {
    const match = haystack.match(candidate.pattern);
    if (match) {
      return {
        reason: candidate.reason,
        matchedText: match[0]
      };
    }
  }

  return undefined;
}

export function isTerminalSessionErrorCode(code: string | undefined): boolean {
  return typeof code === "string" && TERMINAL_SESSION_ERRORS.has(code as ErrorCode);
}
