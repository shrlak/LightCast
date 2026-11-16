// Deleting media files for good: from this computer and, when signed in, from the church server (so the storage % drops).
import { cloudApi, loadSession } from './cloud';
import { deleteMedia, forgetMediaUrl } from './media';
import { mediaFreedByPurge } from './trash';
import type { Library } from './types';
import type { Action } from './reducer';

/** Remove the files from this computer and the church server. Returns the ids that could not be removed from the server. */
export async function dropMediaFiles(ids: readonly string[]): Promise<string[]> {
  const token = loadSession()?.token;
  const failed: string[] = [];
  for (const id of ids) {
    forgetMediaUrl(id);
    await deleteMedia(id).catch(() => undefined);
    if (!token) continue;
    try { await cloudApi.deleteMedia(token, id); }
    catch (e) { if ((e as { status?: number }).status !== 404) failed.push(id); }
  }
  return failed;
}

/** Delete 휴지통 entries for good, and the files only they used from this computer and the server. */
export async function purgeTrashEverywhere(lib: Library, ids: string[], dispatch: (a: Action) => void): Promise<string[]> {
  const freed = mediaFreedByPurge(lib, ids);
  dispatch({ type: 'trash/purge', ids });
  return dropMediaFiles(freed);
}
