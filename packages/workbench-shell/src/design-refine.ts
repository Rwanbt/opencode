/* SPDX-License-Identifier: MIT */

import { openComments, type DesignComment, type CommentState } from "./design-comments.js"

/**
 * P20 — Réinjection d'un commentaire Design vers l'agent.
 *
 * Construit le prompt qui demande à l'agent de modifier **uniquement**
 * l'élément désigné par `elementId` (via `data-unifia-id`). C'est le
 * différenciateur produit du programme : la modification est ciblée,
 * vérifiable, et tracable (le commentaire passe au statut `sent` et
 * devient immuable).
 *
 * Le module est PUR : `buildRefinePrompt` prend un `RefineRequest`
 * (ou un batch via `buildRefineBatchPrompt`) et retourne une string
 * déterministe. Pas d'I/O, pas de DOM. Aucune nouvelle capacité
 * n'est requise : l'envoi passe par `session.prompt` déjà gouvernée
 * par le pipeline de capabilities.
 *
 * Format du prompt (cf. runbook P20 §"Contenu exigé") :
 * 1. nom du fichier d'entrée exact ;
 * 2. attribut de ciblage data-unifia-id="<elementId>" ;
 * 3. note utilisateur entre délimiteurs robustes aux backticks/chevrons ;
 * 4. contrainte explicite de non-régression ;
 * 5. demande de réponse sous forme d'artefact complet (capter par P13).
 *
 * Le prompt est en anglais (la langue du code et des instructions
 * d'agent du dépôt).
 */

export type RefineRequest = {
  artifactId: string
  elementId: string
  note: string
  entryFile: string
}

const REFINE_HEADER = [
  "You are a precise web/UI agent.",
  "The user has a specific, targeted modification request on a single element of the artifact.",
  "You MUST respect the targeting constraints below — touching other elements, reformatting unrelated code, or renaming identifiers is a regression and will be rejected.",
].join(" ")

const REFINE_FOOTER = [
  "Constraints:",
  "- Modify ONLY the element matching the data-unifia-id above and its descendants.",
  "- Do NOT reformat unrelated code, change whitespace outside the targeted element, or rename any other identifiers.",
  "- Do NOT add comments, refactors, or 'while I'm here' cleanups.",
  "- Output the COMPLETE updated artifact (not a diff, not a patch) wrapped in <artifact>...</artifact> markers so the parser can capture it (see P13 contract).",
  "- The artifact must remain a single, valid, self-contained HTML document.",
].join("\n")

/**
 * Plafond de recherche d'un identifiant de délimiteur libre. Chaque
 * tentative allonge l'identifiant, donc la boucle converge ; ce plafond
 * empêche seulement une boucle non bornée sur une entrée pathologique.
 */
const MAX_DELIMITER_ATTEMPTS = 64

/**
 * Délimiteur de note utilisateur. On utilise un triple-backtick fence
 * ET un identifiant unique (le noteId) pour qu'une note contenant des
 * backticks ou des chevrons ne casse pas la délimitation. Si la note
 * elle-même contient la chaîne `<<<NOTE-...>>>`, on suffixe
 * jusqu'à trouver un identifiant libre.
 */
function noteDelimiters(baseId: string, note: string): { open: string; close: string } {
  // Terminaison : chaque tour allonge l'identifiant d'un caractère au
  // moins, donc une note de longueur finie ne peut pas contenir tous les
  // candidats. Le plafond est défensif, jamais atteint en pratique.
  for (let suffix = 0; suffix < MAX_DELIMITER_ATTEMPTS; suffix += 1) {
    const id = suffix === 0 ? baseId : `${baseId}-${suffix}`
    const open = `<<<NOTE-${id}>>>`
    const close = `<<<END-NOTE-${id}>>>`
    if (!note.includes(open) && !note.includes(close)) return { open, close }
  }
  // Repli inatteignable pour une note de taille raisonnable. On préfère
  // un identifiant dérivé de la longueur plutôt qu'un délimiteur nu, qui
  // serait le plus facile à deviner.
  const fallbackId = `${baseId}-x${note.length}`
  return { open: `<<<NOTE-${fallbackId}>>>`, close: `<<<END-NOTE-${fallbackId}>>>` }
}

function noteBaseId(commentId: string): string {
  return `n-${commentId.slice(0, 12)}`
}

/**
 * Pur : construit l'instruction envoyée à l'agent pour UN commentaire.
 * Le prompt est en anglais, délimité, et impose une contrainte forte
 * de non-régression (modification ciblée uniquement).
 */
export function buildRefinePrompt(request: RefineRequest): string {
  const baseId = noteBaseId(`${request.artifactId}:${request.elementId}`)
  const { open, close } = noteDelimiters(baseId, request.note)
  return [
    REFINE_HEADER,
    "",
    `Target file (modify in place): ${request.entryFile}`,
    `Target element: locate the node with data-unifia-id="${request.elementId}" and change it.`,
    "",
    "User instruction (between delimiters, reproduce exactly):",
    open,
    request.note,
    close,
    "",
    REFINE_FOOTER,
  ].join("\n")
}

/**
 * Pur : construit un prompt batch qui couvre PLUSIEURS commentaires
 * `open` en une seule instruction. L'ordre est celui de `openComments`
 * (stable par createdAt puis id). Les commentaires déjà `sent` ne
 * sont pas inclus (déjà appliqués ou refusés).
 */
export function buildRefineBatchPrompt(input: {
  artifactId: string
  entryFile: string
  comments: CommentState
}): string {
  const open = openComments(input.comments)
  if (open.length === 0) {
    return buildRefinePrompt({ artifactId: input.artifactId, elementId: "(none)", note: "(no open comments)", entryFile: input.entryFile })
  }
  if (open.length === 1) {
    const single = open[0]!
    return buildRefinePrompt({
      artifactId: input.artifactId,
      elementId: single.elementId,
      note: single.note,
      entryFile: input.entryFile,
    })
  }
  // Batch : un prompt par commentaire, concaténés avec un séparateur
  // explicite. L'agent applique les modifs dans l'ordre.
  const prompts = open.map((c, i) => {
    const head = `[Modification ${i + 1}/${open.length}]`
    return [head, buildRefinePrompt({
      artifactId: input.artifactId,
      elementId: c.elementId,
      note: c.note,
      entryFile: input.entryFile,
    })].join("\n")
  })
  return [
    "You have N targeted modifications to apply IN ORDER. Each modification below is independent — apply all of them, then output the COMPLETE resulting artifact once at the end.",
    "",
    ...prompts,
    "",
    "Output the COMPLETE updated artifact wrapped in <artifact>...</artifact> markers.",
  ].join("\n\n")
}

/**
 * Pur : valide qu'un commentaire peut être envoyé (statut `open`).
 * Utilisé par le bouton "Envoyer à l'agent" du panneau.
 */
export function canSend(comment: DesignComment): boolean {
  return comment.status === "open"
}

/**
 * Phase 10.3 — un commentaire choisi explicitement par l'utilisateur pour
 * être attaché à son prochain message ("Commenter la conversation").
 * Contrairement à `CommentState` (scopé à UN artefact + son `entryFile`
 * unique), un lot attaché peut couvrir PLUSIEURS artefacts — donc chaque
 * commentaire porte ici son propre `entryFile`, résolu par l'appelant
 * (typiquement depuis la map en mémoire des artefacts ouverts).
 */
export type AttachedComment = DesignComment & { entryFile: string }

/**
 * Pur : comme `buildRefineBatchPrompt`, mais pour un ensemble de
 * commentaires choisis explicitement (pas nécessairement "open" — un
 * commentaire déjà "sent" ou "resolved" reste attachable comme contexte
 * conversationnel), pouvant appartenir à des artefacts différents. Chaque
 * commentaire porte donc son propre `entryFile`, alors que
 * `buildRefineBatchPrompt` en suppose un seul pour tout le lot.
 *
 * Retourne une chaîne vide pour un lot vide — c'est au caller (le
 * composer) de ne préfixer le message utilisateur que si le résultat est
 * non vide, exactement comme il ne préfixe rien quand `attachedIds` est
 * vide.
 */
export function buildAttachedCommentsPrompt(comments: readonly AttachedComment[]): string {
  if (comments.length === 0) return ""
  if (comments.length === 1) {
    const single = comments[0]!
    return buildRefinePrompt({
      artifactId: single.artifactId,
      elementId: single.elementId,
      note: single.note,
      entryFile: single.entryFile,
    })
  }
  const prompts = comments.map((c, i) => {
    const head = `[Modification ${i + 1}/${comments.length}]`
    return [
      head,
      buildRefinePrompt({ artifactId: c.artifactId, elementId: c.elementId, note: c.note, entryFile: c.entryFile }),
    ].join("\n")
  })
  return [
    "You have N targeted modifications to apply IN ORDER, possibly across different artifacts. Each modification below is independent — apply all of them, then output the COMPLETE resulting artifact(s), one <artifact>...</artifact> block per changed artifact, at the end.",
    "",
    ...prompts,
  ].join("\n\n")
}
