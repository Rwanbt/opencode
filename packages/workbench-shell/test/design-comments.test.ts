/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  EMPTY_COMMENT_STATE,
  addComment,
  commentPins,
  commentsForElement,
  markResolved,
  markSent,
  newCommentId,
  openComments,
  pinCenter,
  removeComment,
  updateComment,
  type DesignComment,
  type CommentState,
} from "../src/design-comments"

function comment(overrides: Partial<DesignComment> = {}): DesignComment {
  return {
    id: "c-1",
    artifactId: "a-1",
    elementId: "el-1",
    note: "make this less prominent",
    status: "open",
    createdAt: "2026-08-18T10:00:00.000Z",
    ...overrides,
  }
}

describe("addComment", () => {
  test("ajoute un commentaire à un état vide", () => {
    const next = addComment(EMPTY_COMMENT_STATE, comment())
    expect(next.comments).toHaveLength(1)
    expect(next.comments[0]).toEqual(comment())
  })

  test("préserve l'ordre stable (createdAt puis id)", () => {
    const c1 = comment({ id: "c-1", createdAt: "2026-08-18T10:00:00.000Z" })
    const c2 = comment({ id: "c-2", createdAt: "2026-08-18T10:00:01.000Z" })
    const c3 = comment({ id: "c-3", createdAt: "2026-08-18T10:00:00.000Z" }) // même createdAt que c1
    const state = addComment(EMPTY_COMMENT_STATE, c1)
    const s2 = addComment(state, c2)
    const s3 = addComment(s2, c3)
    expect(s3.comments.map((c) => c.id)).toEqual(["c-1", "c-3", "c-2"])
  })

  test("refuse un doublon d'id (retourne l'état inchangé)", () => {
    const s1 = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1" }))
    const s2 = addComment(s1, comment({ id: "c-1", note: "different" }))
    expect(s2).toBe(s1) // même référence
    expect(s2.comments).toHaveLength(1)
    expect(s2.comments[0]?.note).toBe("make this less prominent") // note inchangée
  })

  test("n mute pas l'état d'entrée", () => {
    const c = comment()
    const before: CommentState = { comments: [c] }
    const snapshot = before.comments
    addComment(before, comment({ id: "c-2" }))
    expect(before.comments).toBe(snapshot)
  })
})

describe("updateComment", () => {
  test("met à jour la note d'un commentaire open", () => {
    const s1 = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1", status: "open" }))
    const s2 = updateComment(s1, "c-1", "nouvelle note")
    expect(s2.comments[0]?.note).toBe("nouvelle note")
    expect(s2.comments[0]?.status).toBe("open")
  })

  test("refuse la modification d'un commentaire sent (immutable)", () => {
    const s1 = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1", status: "sent" }))
    const s2 = updateComment(s1, "c-1", "nouvelle note")
    expect(s2).toBe(s1) // pas de changement
    expect(s2.comments[0]?.note).toBe("make this less prominent")
  })

  test("un commentaire resolved reste éditable (seul sent est immuable)", () => {
    const s1 = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1", status: "resolved" }))
    const s2 = updateComment(s1, "c-1", "note après résolution")
    expect(s2.comments[0]?.note).toBe("note après résolution")
    expect(s2.comments[0]?.status).toBe("resolved")
  })

  test("retourne l'état inchangé si l'id n'existe pas", () => {
    const s1 = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1" }))
    const s2 = updateComment(s1, "unknown", "note")
    expect(s2).toBe(s1)
  })
})

describe("removeComment", () => {
  test("retire un commentaire existant", () => {
    const s1 = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1" }))
    const s2 = addComment(s1, comment({ id: "c-2" }))
    const s3 = removeComment(s2, "c-1")
    expect(s3.comments).toHaveLength(1)
    expect(s3.comments[0]?.id).toBe("c-2")
  })

  test("retourne l'état inchangé si l'id n'existe pas", () => {
    const s1 = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1" }))
    const s2 = removeComment(s1, "unknown")
    expect(s2).toBe(s1)
  })

  test("retirer tous les commentaires laisse un état vide", () => {
    const s1 = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1" }))
    const s2 = removeComment(s1, "c-1")
    expect(s2.comments).toEqual([])
  })
})

describe("commentsForElement", () => {
  test("filtre par elementId", () => {
    const s = addComment(
      addComment(
        addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1", elementId: "el-1" })),
        comment({ id: "c-2", elementId: "el-2" }),
      ),
      comment({ id: "c-3", elementId: "el-1" }),
    )
    const result = commentsForElement(s, "el-1")
    expect(result.map((c) => c.id)).toEqual(["c-1", "c-3"])
  })

  test("retourne [] si aucun commentaire pour cet élément", () => {
    const s = addComment(EMPTY_COMMENT_STATE, comment({ elementId: "el-1" }))
    expect(commentsForElement(s, "unknown")).toEqual([])
  })

  test("inclut les commentaires sent et resolved (pas seulement open)", () => {
    const s = addComment(
      addComment(
        addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1", status: "open" })),
        comment({ id: "c-2", status: "sent" }),
      ),
      comment({ id: "c-3", status: "resolved" }),
    )
    const result = commentsForElement(s, "el-1")
    expect(result.map((c) => c.status)).toEqual(["open", "sent", "resolved"])
  })
})

describe("openComments", () => {
  test("ne renvoie QUE les open (pas sent, pas resolved)", () => {
    const s = addComment(
      addComment(
        addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1", status: "open" })),
        comment({ id: "c-2", status: "sent" }),
      ),
      comment({ id: "c-3", status: "resolved" }),
    )
    const result = openComments(s)
    expect(result.map((c) => c.id)).toEqual(["c-1"])
  })

  test("retourne [] si rien d'open", () => {
    const s = addComment(EMPTY_COMMENT_STATE, comment({ status: "sent" }))
    expect(openComments(s)).toEqual([])
  })

  test("respecte l'ordre stable createdAt puis id", () => {
    const s = addComment(
      addComment(
        addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1", status: "open", createdAt: "2026-08-18T10:00:02.000Z" })),
        comment({ id: "c-2", status: "open", createdAt: "2026-08-18T10:00:01.000Z" }),
      ),
      comment({ id: "c-3", status: "open", createdAt: "2026-08-18T10:00:03.000Z" }),
    )
    const result = openComments(s)
    expect(result.map((c) => c.id)).toEqual(["c-2", "c-1", "c-3"])
  })
})

describe("markSent / markResolved", () => {
  test("markSent : open → sent", () => {
    const s1 = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1", status: "open" }))
    const s2 = markSent(s1, "c-1")
    expect(s2.comments[0]?.status).toBe("sent")
  })

  test("markSent : refuse si déjà sent (idempotent)", () => {
    const s1 = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1", status: "sent" }))
    const s2 = markSent(s1, "c-1")
    expect(s2).toBe(s1)
  })

  test("markSent : refuse si resolved", () => {
    const s1 = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1", status: "resolved" }))
    const s2 = markSent(s1, "c-1")
    expect(s2).toBe(s1)
  })

  test("markResolved : open → resolved", () => {
    const s1 = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1", status: "open" }))
    const s2 = markResolved(s1, "c-1")
    expect(s2.comments[0]?.status).toBe("resolved")
  })

  test("markResolved : refuse si déjà sent (immutable)", () => {
    const s1 = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1", status: "sent" }))
    const s2 = markResolved(s1, "c-1")
    expect(s2).toBe(s1)
  })
})

describe("newCommentId", () => {
  test("génère des ids distincts pour des (now, rand) différents", () => {
    const id1 = newCommentId(1000, 0.1)
    const id2 = newCommentId(1000, 0.2)
    const id3 = newCommentId(2000, 0.1)
    expect(id1).not.toBe(id2)
    expect(id1).not.toBe(id3)
    expect(id2).not.toBe(id3)
  })

  test("commence par 'c-' (préfixe reconnu)", () => {
    expect(newCommentId()).toMatch(/^c-/)
  })
})

describe("pinCenter", () => {
  test("centre d'un rect connu", () => {
    expect(pinCenter({ x: 10, y: 20, width: 100, height: 40 })).toEqual({ x: 60, y: 40 })
  })
  test("rect nul en largeur/hauteur : le centre est le coin", () => {
    expect(pinCenter({ x: 5, y: 5, width: 0, height: 0 })).toEqual({ x: 5, y: 5 })
  })
})

describe("commentPins", () => {
  test("une épingle par commentaire ouvert portant un rect", () => {
    const rect = { x: 1, y: 2, width: 3, height: 4 }
    const s1 = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1", status: "open", rect }))
    expect(commentPins(s1)).toEqual([{ id: "c-1", rect }])
  })
  test("un commentaire ouvert sans rect n'a pas d'épingle", () => {
    const s1 = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1", status: "open" }))
    expect(commentPins(s1)).toEqual([])
  })
  test("un commentaire sent ou resolved n'a pas d'épingle même avec un rect", () => {
    const rect = { x: 1, y: 2, width: 3, height: 4 }
    const s1 = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1", status: "sent", rect }))
    const s2 = addComment(s1, comment({ id: "c-2", status: "resolved", rect }))
    expect(commentPins(s2)).toEqual([])
  })
})
