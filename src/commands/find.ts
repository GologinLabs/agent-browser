import { AppError } from "../lib/errors";
import type {
  CommandContext,
  FindResponse,
  SemanticFindAction,
  SemanticLocatorQuery
} from "../lib/types";
import { getFlagBoolean, getFlagString, parseArgs } from "../lib/utils";
import { resolveSessionId } from "./shared";

const ACTIONS = new Set<SemanticFindAction>(["click", "fill", "type", "hover", "text"]);

function parseFindLocator(positional: string[]): {
  locator: SemanticLocatorQuery;
  action: SemanticFindAction;
  value?: string;
} {
  const mode = positional[0];

  if (mode === "role") {
    const role = positional[1];
    const action = positional[2] as SemanticFindAction | undefined;
    const value = positional.slice(3).join(" ") || undefined;
    if (!role || !action || !ACTIONS.has(action)) {
      throw new AppError("BAD_REQUEST", "Usage: gologin-agent-browser find role <role> <action> [value] [--name <name>]", 400);
    }
    return { locator: { strategy: "role", role }, action, value };
  }

  if (mode === "text") {
    const text = positional[1];
    const action = positional[2] as SemanticFindAction | undefined;
    const value = positional.slice(3).join(" ") || undefined;
    if (!text || !action || !ACTIONS.has(action)) {
      throw new AppError("BAD_REQUEST", "Usage: gologin-agent-browser find text <text> <action> [value]", 400);
    }
    return { locator: { strategy: "text", text }, action, value };
  }

  if (mode === "label") {
    const label = positional[1];
    const action = positional[2] as SemanticFindAction | undefined;
    const value = positional.slice(3).join(" ") || undefined;
    if (!label || !action || !ACTIONS.has(action)) {
      throw new AppError("BAD_REQUEST", "Usage: gologin-agent-browser find label <label> <action> [value]", 400);
    }
    return { locator: { strategy: "label", label }, action, value };
  }

  if (mode === "placeholder") {
    const placeholder = positional[1];
    const action = positional[2] as SemanticFindAction | undefined;
    const value = positional.slice(3).join(" ") || undefined;
    if (!placeholder || !action || !ACTIONS.has(action)) {
      throw new AppError("BAD_REQUEST", "Usage: gologin-agent-browser find placeholder <placeholder> <action> [value]", 400);
    }
    return { locator: { strategy: "placeholder", placeholder }, action, value };
  }

  if (mode === "first" || mode === "last") {
    const selector = positional[1];
    const action = positional[2] as SemanticFindAction | undefined;
    const value = positional.slice(3).join(" ") || undefined;
    if (!selector || !action || !ACTIONS.has(action)) {
      throw new AppError("BAD_REQUEST", `Usage: gologin-agent-browser find ${mode} <selector> <action> [value]`, 400);
    }
    return { locator: { strategy: mode, selector }, action, value };
  }

  if (mode === "nth") {
    const nth = positional[1];
    const selector = positional[2];
    const action = positional[3] as SemanticFindAction | undefined;
    const value = positional.slice(4).join(" ") || undefined;
    if (!nth || !selector || !action || !ACTIONS.has(action) || Number.isNaN(Number(nth))) {
      throw new AppError("BAD_REQUEST", "Usage: gologin-agent-browser find nth <n> <selector> <action> [value]", 400);
    }
    return { locator: { strategy: "nth", selector, nth: Number(nth) }, action, value };
  }

  throw new AppError(
    "BAD_REQUEST",
    "Usage: gologin-agent-browser find <role|text|label|placeholder|first|last|nth> ...",
    400
  );
}

export async function runFindCommand(context: CommandContext, argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sessionId = getFlagString(parsed, "session");
  const name = getFlagString(parsed, "name");
  const exact = getFlagBoolean(parsed, "exact");

  const { locator, action, value } = parseFindLocator(parsed.positional);
  if (locator.strategy === "role" && name) {
    locator.name = name;
  }
  if (exact) {
    locator.exact = true;
  }

  const resolvedSessionId = await resolveSessionId(context, sessionId);
  const response = await context.client.request<FindResponse>(
    "POST",
    `/sessions/${resolvedSessionId}/find`,
    { locator, action, value }
  );

  if (action === "text") {
    context.stdout.write(`${response.value ?? ""}\n`);
    return;
  }

  context.stdout.write(
    `find ${action} session=${response.sessionId} url=${response.url} snapshot=${response.staleSnapshot ? "stale" : "fresh"}\n`
  );
}
