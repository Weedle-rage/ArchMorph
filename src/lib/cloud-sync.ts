import type { SupabaseClient } from "@supabase/supabase-js";
import type { Project } from "./architecture.ts";
import { PROJECT_SCHEMA_VERSION, listLocalProjects, mergeRemoteProjects } from "./persistence.ts";

const TABLE = "projects";

export type SyncResult = { pushed: number; pulled: number };

/**
 * Two-way sync by `updatedAt` (newest copy wins). Local storage stays the working copy;
 * the cloud is a per-user backup and a way to reach projects from other devices.
 */
export async function syncProjects(supabase: SupabaseClient, userId: string): Promise<SyncResult> {
  const { data: remoteRows, error } = await supabase.from(TABLE).select("id, updated_at");
  if (error) throw new Error(error.message);
  const remoteUpdated = new Map((remoteRows ?? []).map((row) => [row.id as string, row.updated_at as string]));

  const local = listLocalProjects();
  const toPush = local.filter((project) => {
    const remote = remoteUpdated.get(project.id);
    return !remote || new Date(project.updatedAt).getTime() > new Date(remote).getTime();
  });
  if (toPush.length) {
    const { error: pushError } = await supabase.from(TABLE).upsert(
      toPush.map((project) => ({
        user_id: userId,
        id: project.id,
        name: project.name,
        schema_version: PROJECT_SCHEMA_VERSION,
        updated_at: project.updatedAt,
        data: project,
      })),
      { onConflict: "user_id,id" },
    );
    if (pushError) throw new Error(pushError.message);
  }

  const localById = new Map(local.map((project) => [project.id, project]));
  const wanted = [...remoteUpdated].filter(([id, updated]) => {
    const mine = localById.get(id);
    return !mine || new Date(updated).getTime() > new Date(mine.updatedAt).getTime();
  }).map(([id]) => id);

  let pulled = 0;
  if (wanted.length) {
    const { data, error: pullError } = await supabase.from(TABLE).select("data").in("id", wanted);
    if (pullError) throw new Error(pullError.message);
    pulled = mergeRemoteProjects((data ?? []).map((row) => row.data as Project));
  }
  return { pushed: toPush.length, pulled };
}

export async function deleteCloudProject(supabase: SupabaseClient, projectId: string) {
  const { error } = await supabase.from(TABLE).delete().eq("id", projectId);
  if (error) throw new Error(error.message);
}
