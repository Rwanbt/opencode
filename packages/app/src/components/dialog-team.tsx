import { onMount } from "solid-js"
import { Dialog } from "@unifia/ui/dialog"
import { useLanguage } from "@/context/language"
import { useTeam } from "@/context/team"
import { teamLabels } from "@/i18n/team-labels"
import { TeamPanel } from "./team/team-panel"

export function DialogTeam() {
  const language = useLanguage()
  const team = useTeam()

  onMount(() => {
    void Promise.all([team.runs.refresh(), team.models.refresh(), team.health.refresh()])
  })

  return (
    <Dialog size="x-large" transition>
      <TeamPanel labels={teamLabels(language.t)} />
    </Dialog>
  )
}
