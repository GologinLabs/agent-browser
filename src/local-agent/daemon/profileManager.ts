import { AppError } from "../lib/errors";
import { buildProfileProxyCheck } from "../lib/profileProxyCheck";
import {
  getRegistryProfile,
  listRegistryProfiles,
  mergeTags,
  removeRegistryProfile,
  upsertRegistryProfile
} from "../lib/profileRegistry";
import type {
  AgentConfig,
  ProfileSourceMode,
  ProfileCreateRequest,
  ProfileCreateResponse,
  ProfileDeleteResponse,
  ProfileImportRequest,
  ProfileImportResponse,
  ProfileProxyCheckResponse,
  ProfileResponse,
  ProfileView,
  ProfilesResponse,
  ProfileSyncResponse,
  ProfileUpdateRequest,
  ProfileUpdateResponse,
  ProxySummary,
  RegistryProfile
} from "../lib/types";
import {
  applyProfileProxy,
  createRemoteProfile,
  deleteProfile,
  getRemoteProfileInfo,
  listRemoteProfiles,
  updateRemoteProfile,
  type RemoteProfileInfo
} from "./browser";

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeTags(tags?: string[]): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))].sort();
}

function normalizeStatus(value: string | undefined, fallback = "active"): string {
  return cleanText(value) ?? fallback;
}

type RegistryMetadata = {
  source: RegistryProfile["source"];
  platform?: string;
  accountLabel?: string;
  region?: string;
  status?: string;
  notes?: string;
  tags?: string[];
  proxy?: ProxySummary;
};

function resolveRegistryProxy(
  remoteProxy: ProxySummary | undefined,
  existingProxy: ProxySummary | undefined,
  preferredProxy: ProxySummary | undefined
): ProxySummary | undefined {
  if (preferredProxy) {
    return preferredProxy;
  }

  if (remoteProxy && remoteProxy.mode !== "none") {
    return remoteProxy;
  }

  if (existingProxy && existingProxy.mode !== "none") {
    return existingProxy;
  }

  return remoteProxy ?? existingProxy;
}

export class ProfileManager {
  constructor(private readonly config: AgentConfig) {}

  private nowIso(): string {
    return new Date().toISOString();
  }

  private requireToken(): string {
    if (!this.config.token) {
      throw new AppError("TOKEN_MISSING", "GOLOGIN_TOKEN is required for profile operations", 400);
    }

    return this.config.token;
  }

  private buildRegistryProfile(
    remote: RemoteProfileInfo,
    metadata: RegistryMetadata,
    existing?: RegistryProfile
  ): RegistryProfile {
    const now = this.nowIso();

    return {
      profileId: remote.profileId,
      source: existing?.source ?? metadata.source,
      name: remote.name,
      platform: cleanText(metadata.platform) ?? existing?.platform,
      accountLabel: cleanText(metadata.accountLabel) ?? existing?.accountLabel,
      region: cleanText(metadata.region) ?? existing?.region,
      status: normalizeStatus(metadata.status, existing?.status ?? "active"),
      notes: metadata.notes !== undefined ? metadata.notes : remote.notes ?? existing?.notes,
      tags: normalizeTags(metadata.tags ?? existing?.tags),
      proxy: resolveRegistryProxy(remote.proxy, existing?.proxy, metadata.proxy),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastSyncedAt: now,
      os: remote.os ?? existing?.os,
      userAgent: remote.userAgent ?? existing?.userAgent
    };
  }

  private toProfileView(profile: RegistryProfile): ProfileView {
    return {
      ...profile,
      registered: true
    };
  }

  private mergeRemoteProfile(remote: RemoteProfileInfo, existing?: RegistryProfile): ProfileView {
    return {
      profileId: remote.profileId,
      source: existing?.source ?? "remote",
      registered: Boolean(existing),
      name: remote.name,
      platform: existing?.platform,
      accountLabel: existing?.accountLabel,
      region: existing?.region,
      status: existing?.status ?? "unregistered",
      notes: remote.notes ?? existing?.notes,
      tags: existing?.tags ?? [],
      proxy: remote.proxy ?? existing?.proxy,
      createdAt: existing?.createdAt,
      updatedAt: existing?.updatedAt,
      lastSyncedAt: existing?.lastSyncedAt,
      os: remote.os ?? existing?.os,
      userAgent: remote.userAgent ?? existing?.userAgent
    };
  }

  private matchesFilters(
    profile: ProfileView,
    filters: {
      platform?: string;
      status?: string;
      tag?: string;
      search?: string;
    }
  ): boolean {
    if (filters.platform && profile.platform !== filters.platform) {
      return false;
    }

    if (filters.status && profile.status !== filters.status) {
      return false;
    }

    if (filters.tag && !profile.tags.includes(filters.tag)) {
      return false;
    }

    if (!filters.search) {
      return true;
    }

    const needle = filters.search.trim().toLowerCase();
    if (!needle) {
      return true;
    }

    return [
      profile.profileId,
      profile.name,
      profile.platform,
      profile.accountLabel,
      profile.region,
      profile.status,
      profile.notes,
      profile.source
    ]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .some((value) => value.toLowerCase().includes(needle));
  }

  private resolveSourceMode(source: ProfileSourceMode | undefined): Exclude<ProfileSourceMode, "auto"> {
    if (source && source !== "auto") {
      return source;
    }

    return this.config.token ? "remote" : "local";
  }

  async list(filters: {
    platform?: string;
    status?: string;
    tag?: string;
    search?: string;
    source?: ProfileSourceMode;
  }): Promise<ProfilesResponse> {
    const source = this.resolveSourceMode(filters.source);
    const registryProfiles = listRegistryProfiles(this.config, {});
    const registryById = new Map(registryProfiles.map((profile) => [profile.profileId, profile]));
    const views: ProfileView[] = [];

    if (source === "local") {
      views.push(...registryProfiles.map((profile) => this.toProfileView(profile)));
    } else {
      const token = this.requireToken();
      const remoteProfiles = await listRemoteProfiles(this.config, token);
      const seen = new Set<string>();

      for (const remote of remoteProfiles) {
        views.push(this.mergeRemoteProfile(remote, registryById.get(remote.profileId)));
        seen.add(remote.profileId);
      }

      if (source === "all") {
        for (const profile of registryProfiles) {
          if (!seen.has(profile.profileId)) {
            views.push(this.toProfileView(profile));
          }
        }
      }
    }

    const profiles = views.filter((profile) => this.matchesFilters(profile, filters));
    return {
      total: profiles.length,
      profiles
    };
  }

  async get(profileId: string, source?: ProfileSourceMode): Promise<ProfileResponse> {
    const mode = this.resolveSourceMode(source);
    const existing = getRegistryProfile(this.config, profileId);

    if (mode === "local") {
      if (!existing) {
        throw new AppError("BAD_REQUEST", `profile ${profileId} is not registered locally`, 404, {
          profileId
        });
      }

      return { profile: this.toProfileView(existing) };
    }

    try {
      const token = this.requireToken();
      const remote = await getRemoteProfileInfo(this.config, token, profileId);
      return {
        profile: this.mergeRemoteProfile(remote, existing)
      };
    } catch (error) {
      if (existing && mode === "all") {
        return {
          profile: this.toProfileView(existing)
        };
      }

      throw error;
    }
  }

  async create(request: ProfileCreateRequest): Promise<ProfileCreateResponse> {
    const token = this.requireToken();
    const name = cleanText(request.name);
    if (!name) {
      throw new AppError("BAD_REQUEST", "profile name is required", 400);
    }

    const notes = request.notes ?? "";
    const profileId = await createRemoteProfile(this.config, token, {
      name,
      notes
    });

    try {
      let proxy: ProxySummary | undefined;
      if (request.proxy) {
        proxy = await applyProfileProxy(this.config, token, profileId, request.proxy);
      }

      const remote = await getRemoteProfileInfo(this.config, token, profileId);
      const profile = this.buildRegistryProfile(
        {
          ...remote,
          proxy: remote.proxy ?? proxy
        },
        {
          source: "created",
          platform: request.platform,
          accountLabel: request.accountLabel,
          region: request.region,
          status: request.status,
          notes: request.notes,
          tags: request.tags,
          proxy
        }
      );

      upsertRegistryProfile(this.config, profile);
      return {
        created: true,
        profile
      };
    } catch (error) {
      await deleteProfile(token, profileId).catch(() => undefined);
      throw error;
    }
  }

  async import(request: ProfileImportRequest): Promise<ProfileImportResponse> {
    const token = this.requireToken();
    const profileId = cleanText(request.profileId);
    if (!profileId) {
      throw new AppError("BAD_REQUEST", "profileId is required", 400);
    }

    const remote = await getRemoteProfileInfo(this.config, token, profileId);
    const existing = getRegistryProfile(this.config, profileId);
    const profile = this.buildRegistryProfile(
      remote,
      {
        source: existing?.source ?? "imported",
        platform: request.platform,
        accountLabel: request.accountLabel,
        region: request.region,
        status: request.status,
        notes: request.notes,
        tags: request.tags
      },
      existing
    );

    upsertRegistryProfile(this.config, profile);
    return {
      imported: true,
      profile
    };
  }

  async update(profileId: string, request: ProfileUpdateRequest): Promise<ProfileUpdateResponse> {
    const existing = getRegistryProfile(this.config, profileId);
    if (!existing) {
      throw new AppError("BAD_REQUEST", `profile ${profileId} is not registered locally`, 404, {
        profileId
      });
    }

    const token = this.requireToken();
    let remote: RemoteProfileInfo = {
      profileId: existing.profileId,
      name: existing.name,
      notes: existing.notes,
      proxy: existing.proxy,
      os: existing.os,
      userAgent: existing.userAgent
    };

    if (request.name !== undefined || request.notes !== undefined) {
      remote = await updateRemoteProfile(this.config, token, profileId, {
        name: request.name,
        notes: request.notes
      });
    }

    let appliedProxy: ProxySummary | undefined;
    if (request.proxy) {
      appliedProxy = await applyProfileProxy(this.config, token, profileId, request.proxy);
      remote = await getRemoteProfileInfo(this.config, token, profileId);
    }

    const profile: RegistryProfile = {
      ...existing,
      ...this.buildRegistryProfile(
        {
          ...remote,
          proxy: request.proxy ? remote.proxy ?? appliedProxy : remote.proxy
        },
        {
          source: existing.source,
          platform: request.platform ?? existing.platform,
          accountLabel: request.accountLabel ?? existing.accountLabel,
          region: request.region ?? existing.region,
          status: request.status ?? existing.status,
          notes: request.notes !== undefined ? request.notes : remote.notes ?? existing.notes,
          proxy: appliedProxy,
          tags: mergeTags(existing.tags, {
            tags: request.tags,
            addTags: request.addTags,
            removeTags: request.removeTags
          })
        },
        existing
      )
    };

    upsertRegistryProfile(this.config, profile);
    return {
      updated: true,
      profile
    };
  }

  async checkProxy(profileId: string): Promise<ProfileProxyCheckResponse> {
    const existing = getRegistryProfile(this.config, profileId);
    const token = this.config.token;

    if (!token) {
      return {
        check: buildProfileProxyCheck({
          profileId,
          localProxy: existing?.proxy,
          localRegistered: Boolean(existing),
          remoteState: "unavailable",
          remoteWarning: "GOLOGIN_TOKEN is not configured"
        })
      };
    }

    try {
      const remote = await getRemoteProfileInfo(this.config, token, profileId);
      return {
        check: buildProfileProxyCheck({
          profileId,
          localProxy: existing?.proxy,
          remoteProxy: remote.proxy,
          localRegistered: Boolean(existing),
          remoteState: "available"
        })
      };
    } catch (error) {
      if (error instanceof AppError && error.status === 404) {
        return {
          check: buildProfileProxyCheck({
            profileId,
            localProxy: existing?.proxy,
            localRegistered: Boolean(existing),
            remoteState: "missing"
          })
        };
      }

      return {
        check: buildProfileProxyCheck({
          profileId,
          localProxy: existing?.proxy,
          localRegistered: Boolean(existing),
          remoteState: "unavailable",
          remoteWarning: error instanceof Error ? error.message : String(error)
        })
      };
    }
  }

  async sync(profileId: string): Promise<ProfileSyncResponse> {
    const token = this.requireToken();
    const existing = getRegistryProfile(this.config, profileId);
    const remote = await getRemoteProfileInfo(this.config, token, profileId);
    const profile = this.buildRegistryProfile(
      remote,
      {
        source: existing?.source ?? "imported",
        platform: existing?.platform,
        accountLabel: existing?.accountLabel,
        region: existing?.region,
        status: existing?.status,
        notes: existing?.notes,
        tags: existing?.tags
      },
      existing
    );

    upsertRegistryProfile(this.config, profile);
    return {
      synced: true,
      profile
    };
  }

  async delete(profileId: string, remote = false): Promise<ProfileDeleteResponse> {
    let remoteDeleted = false;

    if (remote) {
      const token = this.requireToken();
      await deleteProfile(token, profileId);
      remoteDeleted = true;
    }

    const removed = removeRegistryProfile(this.config, profileId);
    if (!removed && !remoteDeleted) {
      throw new AppError("BAD_REQUEST", `profile ${profileId} is not registered locally`, 404, {
        profileId
      });
    }

    return {
      removed: true,
      profileId,
      remoteDeleted
    };
  }
}
