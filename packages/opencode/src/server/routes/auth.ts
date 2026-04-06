import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { User } from "../../user"
import { UserID, UserRole } from "../../user/schema"
import { JwtAuth } from "../auth-jwt"
import { errors } from "../error"

const AuthResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({
    id: z.string(),
    username: z.string(),
    role: UserRole,
  }),
})

export const AuthRoutes = () =>
  new Hono()
    .post(
      "/register",
      describeRoute({
        summary: "Register user",
        description:
          "Register a new collaborative user. First user becomes admin, subsequent users require admin privileges.",
        operationId: "collab.register",
        responses: {
          200: {
            description: "User registered successfully",
            content: { "application/json": { schema: resolver(AuthResponse) } },
          },
          ...errors(400, 403),
        },
      }),
      validator(
        "json",
        z.object({
          username: z.string().min(2).max(50),
          password: z.string().min(8),
          email: z.string().email().optional(),
          displayName: z.string().optional(),
          role: UserRole.optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const isFirstUser = User.count() === 0

        // First user auto-becomes admin; subsequent users require admin caller
        if (!isFirstUser) {
          const caller = c.get("user" as never) as { role: string } | undefined
          if (!caller || caller.role !== "admin") {
            return c.json({ error: "Only admins can register new users" }, 403)
          }
        }

        const existing = User.getByUsername(body.username)
        if (existing) {
          return c.json({ error: "Username already taken" }, 400)
        }

        const user = await User.register({
          username: body.username,
          password: body.password,
          email: body.email,
          displayName: body.displayName,
          role: isFirstUser ? "admin" : (body.role ?? "member"),
        })

        const tokens = JwtAuth.issue(user)
        return c.json({
          ...tokens,
          user: { id: user.id, username: user.username, role: user.role },
        })
      },
    )
    .post(
      "/login",
      describeRoute({
        summary: "Login",
        description: "Authenticate with username and password, receive JWT tokens.",
        operationId: "collab.login",
        responses: {
          200: {
            description: "Login successful",
            content: { "application/json": { schema: resolver(AuthResponse) } },
          },
          ...errors(401),
        },
      }),
      validator(
        "json",
        z.object({
          username: z.string(),
          password: z.string(),
        }),
      ),
      async (c) => {
        const { username, password } = c.req.valid("json")
        const user = await User.authenticate(username, password)
        if (!user) {
          return c.json({ error: "Invalid credentials" }, 401)
        }

        const tokens = JwtAuth.issue(user)
        return c.json({
          ...tokens,
          user: { id: user.id, username: user.username, role: user.role },
        })
      },
    )
    .post(
      "/refresh",
      describeRoute({
        summary: "Refresh token",
        description: "Exchange a refresh token for new access and refresh tokens (token rotation).",
        operationId: "collab.refresh",
        responses: {
          200: {
            description: "Tokens refreshed",
            content: { "application/json": { schema: resolver(AuthResponse) } },
          },
          ...errors(401),
        },
      }),
      validator(
        "json",
        z.object({
          refreshToken: z.string(),
        }),
      ),
      async (c) => {
        const { refreshToken } = c.req.valid("json")
        const result = JwtAuth.refresh(refreshToken)
        if (!result) {
          return c.json({ error: "Invalid or expired refresh token" }, 401)
        }

        const payload = JwtAuth.verifyAccessToken(result.accessToken)!
        return c.json({
          ...result,
          user: { id: payload.sub, username: payload.username, role: payload.role },
        })
      },
    )
    .post(
      "/logout",
      describeRoute({
        summary: "Logout",
        description: "Revoke a refresh token.",
        operationId: "collab.logout",
        responses: {
          200: {
            description: "Logged out",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      validator(
        "json",
        z.object({
          refreshToken: z.string(),
        }),
      ),
      async (c) => {
        const { refreshToken } = c.req.valid("json")
        User.Token.revoke(refreshToken)
        return c.json(true)
      },
    )
    .get(
      "/me",
      describeRoute({
        summary: "Get current user",
        description: "Get the authenticated user's information.",
        operationId: "collab.me",
        responses: {
          200: {
            description: "Current user info",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    id: z.string(),
                    username: z.string(),
                    role: UserRole,
                    email: z.string().nullable().optional(),
                    displayName: z.string().nullable().optional(),
                  }),
                ),
              },
            },
          },
          ...errors(401),
        },
      }),
      async (c) => {
        const caller = c.get("user" as never) as { id: string; username: string; role: string } | undefined
        if (!caller || caller.id === "basic-auth") {
          return c.json({
            id: "basic-auth",
            username: caller?.username ?? "opencode",
            role: "admin",
            email: null,
            displayName: null,
          })
        }
        const user = User.get(caller.id as UserID)
        if (!user) {
          return c.json({ error: "User not found" }, 401)
        }
        return c.json({
          id: user.id,
          username: user.username,
          role: user.role,
          email: user.email,
          displayName: user.displayName,
        })
      },
    )
    .get(
      "/users",
      describeRoute({
        summary: "List users",
        description: "List all collaborative users. Requires admin role.",
        operationId: "collab.listUsers",
        responses: {
          200: {
            description: "User list",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      username: z.string(),
                      role: UserRole,
                      email: z.string().nullable().optional(),
                      displayName: z.string().nullable().optional(),
                    }),
                  ),
                ),
              },
            },
          },
          ...errors(403),
        },
      }),
      async (c) => {
        const caller = c.get("user" as never) as { role: string } | undefined
        if (!caller || caller.role !== "admin") {
          return c.json({ error: "Admin access required" }, 403)
        }
        const users = User.list()
        return c.json(
          users.map((u) => ({
            id: u.id,
            username: u.username,
            role: u.role,
            email: u.email,
            displayName: u.displayName,
          })),
        )
      },
    )
