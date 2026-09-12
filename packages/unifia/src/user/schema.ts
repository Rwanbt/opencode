import { Schema } from "effect"
import z from "zod"
import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"

export const UserID = Schema.String.pipe(
  Schema.brand("UserID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("user", id)),
    zod: Identifier.schema("user").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)

export type UserID = Schema.Schema.Type<typeof UserID>

export const UserRole = z.enum(["admin", "member", "viewer"])
export type UserRole = z.infer<typeof UserRole>
