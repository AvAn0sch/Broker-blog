import { getEnvironment } from "../src/config/env.ts";

// Fail before opening a listening socket, including when test controls are misconfigured.
getEnvironment();
