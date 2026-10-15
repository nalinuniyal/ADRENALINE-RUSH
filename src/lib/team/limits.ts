import type { RateLimitRule } from "@/lib/security/rate-limit";

/** Rate limits for team invitations (Postgres-backed, see consume_rate_limit). */
export const INVITE_LIMITS = {
  sendPerUser: { namespace: "invite-send-user", limit: 30, windowSeconds: 60 * 60 },
  acceptPerIp: { namespace: "invite-accept-ip", limit: 10, windowSeconds: 15 * 60 },
  acceptPerToken: { namespace: "invite-accept-token", limit: 8, windowSeconds: 60 * 60 },
  viewPerIp: { namespace: "invite-view-ip", limit: 60, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;
