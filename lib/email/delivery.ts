import { createHash } from "node:crypto";

export interface MailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface DeliveryTransport {
  sendMail(message: MailOptions & { from: string }): unknown | Promise<unknown>;
  verify(): unknown | Promise<unknown>;
}

export interface DeliveryDependencies {
  getTransport(): DeliveryTransport | null | Promise<DeliveryTransport | null>;
  mailFrom(): string;
}

const ERROR_CLASSES = {
  EAUTH: "authentication", ECONNECTION: "connection", ETIMEDOUT: "timeout",
  ESOCKET: "connection", EDNS: "connection", EENVELOPE: "provider",
  EMESSAGE: "provider", ESTREAM: "provider", UNKNOWN: "unknown",
} as const;
const CODE_ALIASES = {
  ECONNREFUSED: "ECONNECTION", ECONNRESET: "ECONNECTION",
  ENOTFOUND: "EDNS", EAI_AGAIN: "EDNS",
} as const;

export type DeliveryErrorCode = keyof typeof ERROR_CLASSES;
export type DeliveryErrorClass = (typeof ERROR_CLASSES)[DeliveryErrorCode];
export interface FailedOutcome {
  status: "failed";
  errorClass: DeliveryErrorClass;
  errorCode: DeliveryErrorCode;
}

function failure(error: unknown): FailedOutcome {
  let code: unknown;
  try {
    code = error && typeof error === "object" && "code" in error ? error.code : null;
  } catch { /* Even hostile error getters must not reject a best-effort send. */ }
  if (code === "ETLS") return { status: "failed", errorClass: "provider", errorCode: "ESOCKET" };
  if (typeof code === "string" && Object.hasOwn(CODE_ALIASES, code)) {
    code = CODE_ALIASES[code as keyof typeof CODE_ALIASES];
  }
  if (typeof code === "string" && Object.hasOwn(ERROR_CLASSES, code)) {
    const errorCode = code as DeliveryErrorCode;
    return { status: "failed", errorClass: ERROR_CLASSES[errorCode], errorCode };
  }
  return { status: "failed", errorClass: "unknown", errorCode: "UNKNOWN" };
}

export type DeliveryOutcome =
  | { status: "sent"; /** SHA256 hex fingerprint, never the raw provider ID. */ providerMessageId: string | null }
  | { status: "not_configured" }
  | FailedOutcome;

export type CheckOutcome = { status: "verified" } | { status: "not_configured" } | FailedOutcome;

export function createDelivery(dependencies: DeliveryDependencies) {
  return {
    async verifySmtp(): Promise<CheckOutcome> {
      try {
        const transport = await dependencies.getTransport();
        if (!transport) return { status: "not_configured" };
        const verified = await transport.verify();
        return verified === true ? { status: "verified" } : failure(null);
      } catch (error) {
        return failure(error);
      }
    },
    async sendMail(options: MailOptions): Promise<DeliveryOutcome> {
      try {
        const transport = await dependencies.getTransport();
        if (!transport) return { status: "not_configured" };
        const result = await transport.sendMail({ ...options, from: dependencies.mailFrom() });
        if (result && typeof result === "object") {
          const rejected = "rejected" in result ? result.rejected : undefined;
          const accepted = "accepted" in result ? result.accepted : undefined;
          if ((Array.isArray(rejected) && rejected.length > 0) || (Array.isArray(accepted) && accepted.length === 0)) {
            return failure({ code: "EENVELOPE" });
          }
        }
        const id = result && typeof result === "object" && "messageId" in result ? result.messageId : null;
        return {
          status: "sent",
          providerMessageId: typeof id === "string" && id.length > 0 ? createHash("sha256").update(id).digest("hex") : null,
        };
      } catch (error) {
        return failure(error);
      }
    },
  };
}
