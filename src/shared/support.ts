export interface SupportMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  responder?: "ai" | "human";
  checkedAt?: string;
  dataUpdatedAt?: string;
  stateVersion?: number;
  lookups?: Array<{ tool: string; arguments: Record<string, unknown>; result: unknown }>;
  interactionAnswered?: boolean;
  interaction?: { type: "single_choice"; prompt: string; options: Array<{ id: string; label: string; description?: string }>; actionToken?: string };
}
export interface SupportConversation {
  id: string;
  username: string;
  displayName: string;
  serviceLine?: string;
  messages: SupportMessage[];
  revision: number;
  humanJoined: boolean;
  active: boolean;
  busy: boolean;
  pendingRequestId?: string;
  owner?: string;
}
