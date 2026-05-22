import type { Page } from "playwright";

import type {
  RawSnapshotCandidate,
  RefDescriptor,
  SnapshotBuildResult,
  SnapshotItem,
  SnapshotKind
} from "../lib/types";

type SnapshotOptions = {
  interactive?: boolean;
};

const INTERACTIVE_KINDS = new Set<SnapshotKind>([
  "link",
  "button",
  "input",
  "checkbox",
  "radio",
  "textarea",
  "select"
]);

function normalizeWhitespace(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function buildCandidateKey(candidate: RawSnapshotCandidate): string {
  return [
    candidate.kind,
    candidate.tag,
    candidate.role ?? "",
    normalizeWhitespace(candidate.accessibleName) ?? "",
    normalizeWhitespace(candidate.text) ?? "",
    normalizeWhitespace(candidate.ariaLabel) ?? "",
    normalizeWhitespace(candidate.placeholder) ?? "",
    normalizeWhitespace(candidate.name) ?? "",
    normalizeWhitespace(candidate.href) ?? "",
    normalizeWhitespace(candidate.inputType) ?? "",
    normalizeWhitespace(candidate.accept) ?? "",
    candidate.multiple === true ? "multiple" : ""
  ].join("|");
}

function candidateText(candidate: RawSnapshotCandidate): string | undefined {
  const inputType = normalizeWhitespace(candidate.inputType)?.toLowerCase();
  if (candidate.tag === "input" && inputType === "file") {
    return (
      normalizeWhitespace(candidate.accessibleName) ??
      normalizeWhitespace(candidate.placeholder) ??
      normalizeWhitespace(candidate.name) ??
      "file upload"
    );
  }

  return (
    normalizeWhitespace(candidate.accessibleName) ??
    normalizeWhitespace(candidate.text) ??
    normalizeWhitespace(candidate.selectedText) ??
    normalizeWhitespace(candidate.placeholder) ??
    normalizeWhitespace(candidate.name) ??
    normalizeWhitespace(candidate.href)
  );
}

export function buildSnapshotModel(
  rawCandidates: RawSnapshotCandidate[],
  options: SnapshotOptions = {}
): SnapshotBuildResult {
  const counters = new Map<string, number>();
  const items: SnapshotItem[] = [];
  const refs: RefDescriptor[] = [];

  for (const candidate of rawCandidates) {
    if (options.interactive && !INTERACTIVE_KINDS.has(candidate.kind)) {
      continue;
    }

    const text = candidateText(candidate);
    if (!text) {
      continue;
    }

    const key = buildCandidateKey(candidate);
    const nth = counters.get(key) ?? 0;
    counters.set(key, nth + 1);

    const ref = `@e${items.length + 1}`;

    items.push({
      ref,
      kind: candidate.kind,
      text,
      role: candidate.role,
      flags: [
        ...(candidate.checked === true ? ["checked"] : []),
        ...(candidate.disabled === true ? ["disabled"] : []),
        ...(candidate.tag === "input" && normalizeWhitespace(candidate.inputType)?.toLowerCase() === "file"
          ? [
              "upload",
              "file-input",
              ...(candidate.visible === false ? ["hidden"] : []),
              ...(candidate.multiple === true ? ["multiple"] : []),
              ...(normalizeWhitespace(candidate.accept) ? [`accept=${normalizeWhitespace(candidate.accept)}`] : [])
            ]
          : []),
        ...(normalizeWhitespace(candidate.selectedText) ? [`selected=${normalizeWhitespace(candidate.selectedText)}`] : [])
      ]
    });

    refs.push({
      ref,
      kind: candidate.kind,
      tag: candidate.tag,
      role: candidate.role,
      text: normalizeWhitespace(candidate.text),
      accessibleName: normalizeWhitespace(candidate.accessibleName),
      ariaLabel: normalizeWhitespace(candidate.ariaLabel),
      placeholder: normalizeWhitespace(candidate.placeholder),
      inputType: normalizeWhitespace(candidate.inputType),
      accept: normalizeWhitespace(candidate.accept),
      multiple: candidate.multiple,
      visible: candidate.visible,
      fileInputIndex: candidate.fileInputIndex,
      name: normalizeWhitespace(candidate.name),
      href: normalizeWhitespace(candidate.href),
      nth,
      checked: candidate.checked,
      disabled: candidate.disabled,
      selectedText: normalizeWhitespace(candidate.selectedText)
    });
  }

  return { items, refs };
}

export async function buildSnapshot(page: Page, options: SnapshotOptions = {}): Promise<SnapshotBuildResult> {
  const candidates = await page.evaluate<RawSnapshotCandidate[]>(() => {
    const selectors = [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "a",
      "button",
      "input",
      "textarea",
      "select",
      "p",
      "[role='heading']",
      "[role='link']",
      "[role='button']",
      "[role='textbox']"
    ].join(",");

    const seen = new WeakSet<Element>();

    function normalize(value: string | null | undefined): string | undefined {
      if (!value) {
        return undefined;
      }

      const trimmed = value.replace(/\s+/g, " ").trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }

    function isVisible(element: Element): boolean {
      const htmlElement = element as HTMLElement;
      const style = window.getComputedStyle(htmlElement);
      const rect = htmlElement.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    function isFileInput(element: Element): boolean {
      return element instanceof HTMLInputElement && element.type.toLowerCase() === "file";
    }

    function implicitRole(element: Element): string | undefined {
      const tag = element.tagName.toLowerCase();

      if (/^h[1-6]$/.test(tag)) {
        return "heading";
      }

      if (tag === "a") {
        return "link";
      }

      if (tag === "button") {
        return "button";
      }

      if (tag === "textarea") {
        return "textbox";
      }

      if (tag === "select") {
        return "combobox";
      }

      if (tag === "input") {
        const type = (element as HTMLInputElement).type.toLowerCase();
        if (type === "submit" || type === "button" || type === "reset") {
          return "button";
        }
        if (type === "checkbox") {
          return "checkbox";
        }
        if (type === "radio") {
          return "radio";
        }
        return "textbox";
      }

      return undefined;
    }

    function associatedLabel(element: Element): string | undefined {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        const labels = Array.from(element.labels ?? []);
        const text = labels
          .map((label) => normalize(label.textContent))
          .filter((value): value is string => Boolean(value))
          .join(" ");

        return normalize(text);
      }

      return undefined;
    }

    function kindFor(element: Element): SnapshotKind | undefined {
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute("role");

      if (/^h[1-6]$/.test(tag) || role === "heading") {
        return "heading";
      }
      if (tag === "a" || role === "link") {
        return "link";
      }
      if (tag === "button" || role === "button") {
        return "button";
      }
      if (tag === "textarea") {
        return "textarea";
      }
      if (tag === "select") {
        return "select";
      }
      if (tag === "input") {
        const inputType = (element as HTMLInputElement).type.toLowerCase();
        if (inputType === "checkbox") {
          return "checkbox";
        }
        if (inputType === "radio") {
          return "radio";
        }
        return "input";
      }
      if (role === "textbox") {
        return "input";
      }
      if (tag === "p") {
        return "paragraph";
      }

      return undefined;
    }

    function isParagraphWrappedInteractive(element: Element): boolean {
      if (element.tagName.toLowerCase() !== "p") {
        return false;
      }

      const children = Array.from(element.children);
      if (children.length !== 1) {
        return false;
      }

      const childTag = children[0]?.tagName.toLowerCase();
      return childTag === "a" || childTag === "button";
    }

    const result: RawSnapshotCandidate[] = [];
    let fileInputIndex = 0;

    for (const element of Array.from(document.querySelectorAll(selectors))) {
      const visible = isVisible(element);
      const fileInput = isFileInput(element);
      const currentFileInputIndex = fileInput ? fileInputIndex++ : undefined;
      if (seen.has(element) || (!visible && !fileInput)) {
        continue;
      }

      seen.add(element);

      const tag = element.tagName.toLowerCase();
      const kind = kindFor(element);
      if (!kind) {
        continue;
      }

      if (isParagraphWrappedInteractive(element)) {
        continue;
      }

      const explicitRole = normalize(element.getAttribute("role"));
      const role = explicitRole ?? implicitRole(element);
      const text =
        tag === "input" || tag === "textarea" || tag === "select"
          ? undefined
          : normalize((element as HTMLElement).innerText || element.textContent);
      const placeholder =
        element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          ? normalize(element.placeholder)
          : undefined;
      const inputType = element instanceof HTMLInputElement ? normalize(element.type) : undefined;
      const accept = element instanceof HTMLInputElement ? normalize(element.accept) : undefined;
      const multiple = element instanceof HTMLInputElement ? element.multiple : undefined;
      const name =
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
          ? normalize(element.name)
          : undefined;
      const ariaLabel = normalize(element.getAttribute("aria-label"));
      const label = associatedLabel(element);
      const checked = element instanceof HTMLInputElement ? element.checked : undefined;
      const disabled =
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLButtonElement
          ? element.disabled
          : (element as HTMLElement).hasAttribute("disabled");
      const selectedText =
        element instanceof HTMLSelectElement
          ? normalize(
              Array.from(element.selectedOptions)
                .map((option) => option.textContent ?? "")
                .join(" ")
            )
          : undefined;
      const accessibleName =
        ariaLabel ??
        label ??
        normalize((element as HTMLElement).innerText || element.textContent) ??
        placeholder ??
        name;
      const href = element instanceof HTMLAnchorElement ? normalize(element.href) : undefined;

      result.push({
        kind,
        tag,
        role,
        text,
        accessibleName,
        ariaLabel,
        placeholder,
        inputType,
        accept,
        multiple,
        visible,
        fileInputIndex: currentFileInputIndex,
        name,
        href,
        checked,
        disabled,
        selectedText
      });
    }

    return result;
  });

  return buildSnapshotModel(candidates, options);
}
