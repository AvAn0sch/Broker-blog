import { getPool } from "../../infrastructure/db/client";
import { discoveryService } from "./service";

export function discovery() {
  return discoveryService({ pool: getPool() });
}
