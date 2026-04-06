import type { UserRole } from "./schema"

export namespace RBAC {
  export type Action =
    | "session.create"
    | "session.read"
    | "session.write"
    | "session.delete"
    | "session.observe"
    | "config.write"
    | "user.manage"

  export interface Subject {
    id: string
    role: UserRole
  }

  export interface Resource {
    type: "session" | "config" | "user"
    ownerID?: string
    shared?: boolean
  }

  const PERMISSIONS: Record<UserRole, Set<Action>> = {
    admin: new Set([
      "session.create",
      "session.read",
      "session.write",
      "session.delete",
      "session.observe",
      "config.write",
      "user.manage",
    ]),
    member: new Set([
      "session.create",
      "session.read",
      "session.write",
      "session.delete",
      "session.observe",
    ]),
    viewer: new Set(["session.read", "session.observe"]),
  }

  /**
   * Check if a user can perform an action on a resource.
   * - Admins can do everything.
   * - Members can CRUD their own sessions + observe shared sessions.
   * - Viewers can only read/observe shared sessions.
   */
  export function can(subject: Subject, action: Action, resource?: Resource): boolean {
    // Admin bypass
    if (subject.role === "admin") return true
    // Basic auth (non-collaborative) acts as admin
    if (subject.id === "basic-auth") return true

    // Check base permission
    if (!PERMISSIONS[subject.role]?.has(action)) return false

    // Resource-level checks
    if (resource) {
      if (resource.type === "session") {
        // Members can only modify their own sessions
        if (
          (action === "session.write" || action === "session.delete") &&
          resource.ownerID &&
          resource.ownerID !== subject.id
        ) {
          return false
        }
        // Non-admins can only read other sessions if shared or they own them
        if (
          action === "session.read" &&
          resource.ownerID &&
          resource.ownerID !== subject.id &&
          !resource.shared
        ) {
          // Members can still read all sessions (for awareness)
          // Viewers can only read shared sessions
          if (subject.role === "viewer") return false
        }
      }
      if (resource.type === "config") {
        return false
      }
      if (resource.type === "user") {
        return false
      }
    }

    return true
  }
}
