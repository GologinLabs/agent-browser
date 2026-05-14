import fs from "node:fs";

import type { AgentConfig, ProfileRegistry, RegistryProfile } from "./types";

const EMPTY_REGISTRY: ProfileRegistry = {
  version: 1,
  profiles: []
};

export type RegistryFilters = {
  platform?: string;
  status?: string;
  tag?: string;
  search?: string;
};

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function sortProfiles(profiles: RegistryProfile[]): RegistryProfile[] {
  return [...profiles].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function readProfileRegistry(config: AgentConfig): ProfileRegistry {
  if (!fs.existsSync(config.registryPath)) {
    return structuredClone(EMPTY_REGISTRY);
  }

  try {
    const raw = JSON.parse(fs.readFileSync(config.registryPath, "utf8")) as ProfileRegistry;
    if (raw.version !== 1 || !Array.isArray(raw.profiles)) {
      return structuredClone(EMPTY_REGISTRY);
    }

    return {
      version: 1,
      profiles: sortProfiles(raw.profiles.map((profile) => ({
        ...profile,
        tags: Array.isArray(profile.tags) ? [...new Set(profile.tags.filter(Boolean))].sort() : [],
        status: normalizeText(profile.status) ?? "active"
      })))
    };
  } catch {
    return structuredClone(EMPTY_REGISTRY);
  }
}

export function writeProfileRegistry(config: AgentConfig, registry: ProfileRegistry): void {
  fs.mkdirSync(config.stateDir, { recursive: true });
  fs.writeFileSync(
    config.registryPath,
    `${JSON.stringify({ version: 1, profiles: sortProfiles(registry.profiles) }, null, 2)}\n`,
    "utf8"
  );
}

export function getRegistryProfile(config: AgentConfig, profileId: string): RegistryProfile | undefined {
  return readProfileRegistry(config).profiles.find((profile) => profile.profileId === profileId);
}

export function upsertRegistryProfile(config: AgentConfig, profile: RegistryProfile): RegistryProfile {
  const registry = readProfileRegistry(config);
  const index = registry.profiles.findIndex((entry) => entry.profileId === profile.profileId);

  if (index >= 0) {
    registry.profiles[index] = profile;
  } else {
    registry.profiles.push(profile);
  }

  writeProfileRegistry(config, registry);
  return profile;
}

export function removeRegistryProfile(config: AgentConfig, profileId: string): boolean {
  const registry = readProfileRegistry(config);
  const nextProfiles = registry.profiles.filter((profile) => profile.profileId !== profileId);

  if (nextProfiles.length === registry.profiles.length) {
    return false;
  }

  writeProfileRegistry(config, {
    version: 1,
    profiles: nextProfiles
  });
  return true;
}

export function listRegistryProfiles(config: AgentConfig, filters: RegistryFilters = {}): RegistryProfile[] {
  const search = normalizeText(filters.search)?.toLowerCase();
  const platform = normalizeText(filters.platform)?.toLowerCase();
  const status = normalizeText(filters.status)?.toLowerCase();
  const tag = normalizeText(filters.tag)?.toLowerCase();

  return readProfileRegistry(config).profiles.filter((profile) => {
    if (platform && profile.platform?.toLowerCase() !== platform) {
      return false;
    }
    if (status && profile.status.toLowerCase() !== status) {
      return false;
    }
    if (tag && !profile.tags.some((value) => value.toLowerCase() === tag)) {
      return false;
    }
    if (search) {
      const haystack = [
        profile.profileId,
        profile.name,
        profile.platform,
        profile.accountLabel,
        profile.region,
        profile.notes,
        ...profile.tags
      ]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join("\n")
        .toLowerCase();

      if (!haystack.includes(search)) {
        return false;
      }
    }

    return true;
  });
}

export function mergeTags(
  currentTags: string[],
  options: {
    tags?: string[];
    addTags?: string[];
    removeTags?: string[];
  }
): string[] {
  const next = options.tags ? [...options.tags] : [...currentTags];
  if (options.addTags) {
    next.push(...options.addTags);
  }

  const deduped = [...new Set(next.map((tag) => tag.trim()).filter(Boolean))];
  if (!options.removeTags || options.removeTags.length === 0) {
    return deduped.sort();
  }

  const remove = new Set(options.removeTags.map((tag) => tag.trim()).filter(Boolean));
  return deduped.filter((tag) => !remove.has(tag)).sort();
}
