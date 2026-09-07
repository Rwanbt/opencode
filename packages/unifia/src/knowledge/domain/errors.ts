/* SPDX-License-Identifier: MIT */
/**
 * Knowledge errors at the `packages/unifia` level.
 *
 * The cross-package type is `KnowledgeError` from
 * `@unifia/contracts/knowledge`. This module re-exports it as the
 * runtime error class used by the knowledge subsystem and adds
 * helper constructors for the most common cases.
 */

import type { KnowledgeError, KnowledgeErrorKind } from "@unifia/contracts/knowledge"

export class KnowledgeFailure extends Error {
  readonly kind: KnowledgeErrorKind
  readonly context?: Record<string, string | number | boolean>

  constructor(err: KnowledgeError) {
    super(err.message)
    this.name = "KnowledgeFailure"
    this.kind = err.kind
    if (err.context !== undefined) this.context = err.context
  }

  static egressDenied(message: string, ctx?: Record<string, string | number | boolean>): KnowledgeFailure {
    return new KnowledgeFailure({ kind: "egress_denied", message, context: ctx })
  }

  static pathUnresolved(message: string, ctx?: Record<string, string | number | boolean>): KnowledgeFailure {
    return new KnowledgeFailure({ kind: "path_unresolved", message, context: ctx })
  }

  static casMismatch(expected: string, observed: string): KnowledgeFailure {
    return new KnowledgeFailure({
      kind: "cas_mismatch",
      message: "version hash precondition failed",
      context: { expected, observed },
    })
  }

  static boundExceeded(message: string, ctx?: Record<string, string | number | boolean>): KnowledgeFailure {
    return new KnowledgeFailure({ kind: "bound_exceeded", message, context: ctx })
  }

  static deadlineExceeded(message: string, ctx?: Record<string, string | number | boolean>): KnowledgeFailure {
    return new KnowledgeFailure({ kind: "deadline_exceeded", message, context: ctx })
  }

  static cancelled(message: string, ctx?: Record<string, string | number | boolean>): KnowledgeFailure {
    return new KnowledgeFailure({ kind: "cancelled", message, context: ctx })
  }

  static mutationRefused(message: string, ctx?: Record<string, string | number | boolean>): KnowledgeFailure {
    return new KnowledgeFailure({ kind: "mutation_refused", message, context: ctx })
  }

  static indexUnavailable(message: string, ctx?: Record<string, string | number | boolean>): KnowledgeFailure {
    return new KnowledgeFailure({ kind: "index_unavailable", message, context: ctx })
  }

  static sourceInconsistent(message: string, ctx?: Record<string, string | number | boolean>): KnowledgeFailure {
    return new KnowledgeFailure({ kind: "source_inconsistent", message, context: ctx })
  }

  static invariantViolated(message: string, ctx?: Record<string, string | number | boolean>): KnowledgeFailure {
    return new KnowledgeFailure({ kind: "invariant_violated", message, context: ctx })
  }

  static internal(message: string, ctx?: Record<string, string | number | boolean>): KnowledgeFailure {
    return new KnowledgeFailure({ kind: "internal", message, context: ctx })
  }

  toJSON(): KnowledgeError {
    const out: KnowledgeError = { kind: this.kind, message: this.message }
    if (this.context !== undefined) out.context = this.context
    return out
  }
}
