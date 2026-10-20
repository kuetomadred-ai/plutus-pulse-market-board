export type EngineStatus =
  | "not_started"
  | "starting"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "stopping"
  | "error";

export interface EngineRuntimeStatus {
  status: EngineStatus;
  brokerConnected: boolean;
  lastError: string | null;
  updatedAt: string;
}

let current: EngineRuntimeStatus = {
  status: "not_started",
  brokerConnected: false,
  lastError: null,
  updatedAt: new Date().toISOString(),
};

export function setEngineStatus(status: EngineStatus, error?: unknown) {
  current = {
    status,
    brokerConnected: status === "connected",
    lastError: error instanceof Error ? error.message : error ? String(error) : null,
    updatedAt: new Date().toISOString(),
  };
}

export function getEngineStatus(): EngineRuntimeStatus {
  return { ...current };
}
