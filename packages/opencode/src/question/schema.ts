import { Schema } from "effect"
import type z from "zod"

import { Identifier } from "@/id/id"
import { Newtype } from "@/util/schema"

export class QuestionID extends Newtype<QuestionID>()("QuestionID", Schema.String) {
  static make(id: string): QuestionID {
    return QuestionID.makeUnsafe(id)
  }

  static ascending(id?: string): QuestionID {
    return QuestionID.makeUnsafe(Identifier.ascending("question", id))
  }

  static readonly zod = Identifier.schema("question") as unknown as z.ZodType<QuestionID>
}
