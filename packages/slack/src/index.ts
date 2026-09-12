import { App } from "@slack/bolt"
import { createUnifia, type ToolPart } from "@unifia/sdk"
import { createSlackRemoteAdapter } from "./remote-adapter.ts"

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
})

const remoteAuditLog: string[] = []
const remoteAudit = { record: (event: { type: string; identityId: string; reason?: string }) => { remoteAuditLog.push(event.type); if (remoteAuditLog.length > 1000) remoteAuditLog.shift() } }
const slackRemote = createSlackRemoteAdapter(remoteAudit)

console.log("🔧 Bot configuration:")
console.log("- Bot token present:", !!process.env.SLACK_BOT_TOKEN)
console.log("- Signing secret present:", !!process.env.SLACK_SIGNING_SECRET)
console.log("- App token present:", !!process.env.SLACK_APP_TOKEN)

console.log("🚀 Starting unifia server...")
const unifia = await createUnifia({
  port: 0,
})
console.log("✅ Unifia server ready")

const sessions = new Map<string, { client: any; server: any; sessionId: string; channel: string; thread: string }>()
;(async () => {
  const events = await unifia.client.event.subscribe()
  for await (const event of events.stream) {
    if (event.type === "message.part.updated") {
      const part = event.properties.part
      if (part.type === "tool") {
        // Find the session for this tool update
        for (const [sessionKey, session] of sessions.entries()) {
          if (session.sessionId === part.sessionID) {
            handleToolUpdate(part, session.channel, session.thread)
            break
          }
        }
      }
    }
  }
})()

async function handleToolUpdate(part: ToolPart, channel: string, thread: string) {
  if (part.state.status !== "completed") return
  const toolMessage = `*${part.tool}* - ${part.state.title}`
  await app.client.chat
    .postMessage({
      channel,
      thread_ts: thread,
      text: toolMessage,
    })
    .catch(() => {})
}


app.message(async ({ message, say }) => {


  if (message.subtype || !("text" in message) || !message.text) {
    console.log("⏭️ Skipping message - no text or has subtype")
    return
  }
  if (!("user" in message) || !message.user) return
  const authorized = slackRemote.authorize({ id: message.ts, channelId: message.channel, userId: message.user, text: message.text, timestamp: Number.isFinite(Number(message.ts)) ? Math.floor(Number(message.ts) * 1000) : Date.now() })
  if (!authorized) {
    await say({ text: "This Slack identity or channel is not authorized.", thread_ts: message.ts })
    return
  }
  // `session.prompt` is not a P3 capability; prompting the agent can write the
  // workspace and run tools, so the declared capability has to say so.
  const metadata: Record<string, string> = message.text.startsWith("/read ") ? { mode: "read-only", command: "read" } : { capability: "workspace.write" }
  const command = slackRemote.authorizeCommand(message.user, { id: message.ts, text: message.text, scope: "session", metadata })
  if (command.status === "pending-approval") {
    const approvalId = typeof command.result === "object" && command.result && "approvalId" in command.result ? String(command.result.approvalId) : "pending"
    await say({ text: `Approval required on the host (${approvalId}).`, thread_ts: message.ts })
    return
  }
  if (command.status === "denied") {
    await say({ text: "This remote command was denied by policy.", thread_ts: message.ts })
    return
  }





  const channel = message.channel
  const thread = (message as any).thread_ts || message.ts
  const sessionKey = `${channel}-${thread}`

  let session = sessions.get(sessionKey)

  if (!session) {

    const { client, server } = unifia

    const createResult = await client.session.create({
      body: { title: `Slack thread ${thread}` },
    })

    if (createResult.error) {
      console.error("❌ Failed to create session:")
      await say({
        text: "Sorry, I had trouble creating a session. Please try again.",
        thread_ts: thread,
      })
      return
    }



    session = { client, server, sessionId: createResult.data.id, channel, thread }
    sessions.set(sessionKey, session)

  }


  const result = await session.client.session.prompt({
    path: { id: session.sessionId },
    body: { parts: [{ type: "text", text: message.text }] },
  })



  if (result.error) {
    console.error("❌ Failed to send message:")
    await say({
      text: "Sorry, I had trouble processing your message. Please try again.",
      thread_ts: thread,
    })
    return
  }

  const response = result.data

  // Build response text
  const responseText =
    response.info?.content ||
    response.parts
      ?.filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("\n") ||
    "I received your message but didn't have a response."



  // Send main response (tool updates will come via live events)
  await say({ text: responseText, thread_ts: thread })
})

app.command("/test", async ({ command, ack, say }) => {
  await ack()
  console.log("🧪 Test command received:", JSON.stringify(command, null, 2))
  await say("🤖 Bot is working! I can hear you loud and clear.")
})

await app.start()
console.log("⚡️ Slack bot is running!")
