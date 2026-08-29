import type { SyncRole } from "@inkboard/shared-schema";

/**
 * The laptop opens the same app at /mirror (or ?view=mirror) to watch the
 * iPad's board read-only. One build, one URL to remember, no separate viewer
 * app to keep in step with the real one.
 */
export function syncRoleFromLocation(location: {
  pathname: string;
  search: string;
}): SyncRole {
  if (location.pathname.replace(/\/+$/, "") === "/mirror") return "mirror";
  return new URLSearchParams(location.search).get("view") === "mirror"
    ? "mirror"
    : "editor";
}
