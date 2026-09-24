import { isRecord } from "@openclaw/normalization-core/record-coerce";
import type { FleetContainerRuntimeName } from "./cell-profile.js";

export type FleetNetworkSubnet = { subnet: string; gateway?: string };

export type FleetNetworkCreateOptions = {
  internal: boolean;
  subnets?: readonly FleetNetworkSubnet[];
};

export function validateNetworkName(networkName: string): string {
  const normalized = networkName.trim();
  if (!normalized || normalized.startsWith("-")) {
    throw new Error("Fleet network name is invalid.");
  }
  return normalized;
}

function validateNetworkAddress(value: string): string {
  const normalized = value.trim();
  if (!/^[0-9A-Fa-f:.]+(?:\/\d{1,3})?$/u.test(normalized)) {
    throw new Error("Fleet network subnet is invalid.");
  }
  return normalized;
}

function readSubnetString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("network inspect returned an invalid subnet");
  }
  return value;
}

/** Reads Podman `subnets` or Docker `IPAM.Config` entries from network inspect. */
export function readNetworkSubnets(value: unknown): FleetNetworkSubnet[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("network inspect returned an invalid subnet list");
  }
  return value.map((rawSubnet) => {
    if (!isRecord(rawSubnet)) {
      throw new Error("network inspect returned an invalid subnet");
    }
    const subnet = readSubnetString(rawSubnet.subnet ?? rawSubnet.Subnet);
    if (!subnet) {
      throw new Error("network inspect returned an invalid subnet");
    }
    const gateway = readSubnetString(rawSubnet.gateway ?? rawSubnet.Gateway);
    return gateway ? { subnet, gateway } : { subnet };
  });
}

/**
 * Rootless Podman keeps every cell bridge in one per-user network namespace, so
 * Podman cell networks are always created with netavark isolation (see
 * isCellNetworkIsolated). Docker bridges already drop inter-network traffic.
 */
export function buildNetworkCreateArgs(
  runtime: FleetContainerRuntimeName,
  networkName: string,
  labels: Readonly<Record<string, string>>,
  options: FleetNetworkCreateOptions,
): string[] {
  const args = ["network", "create", "--driver", "bridge"];
  if (runtime === "podman") {
    args.push("--opt", "isolate=true");
  }
  if (options.internal) {
    args.push("--internal");
  }
  for (const entry of options.subnets ?? []) {
    args.push("--subnet", validateNetworkAddress(entry.subnet));
    if (entry.gateway) {
      args.push("--gateway", validateNetworkAddress(entry.gateway));
    }
  }
  for (const [key, value] of Object.entries(labels).toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    args.push("--label", `${key}=${value}`);
  }
  args.push(validateNetworkName(networkName));
  return args;
}
