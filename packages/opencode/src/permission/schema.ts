import { Schema } from "effect"
import type z from "zod"

import { Identifier } from "@/id/id"
import { Newtype } from "@/util/schema"

export class PermissionID extends Newtype<PermissionID>()("PermissionID", Schema.String) {
  static make(id: string): PermissionID {
    return PermissionID.makeUnsafe(id)
  }

  static ascending(id?: string): PermissionID {
    return PermissionID.makeUnsafe(Identifier.ascending("permission", id))
  }

  static readonly zod = Identifier.schema("permission") as unknown as z.ZodType<PermissionID>
}
