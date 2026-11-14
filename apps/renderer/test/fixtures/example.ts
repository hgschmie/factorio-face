// The example circuit of docs/dsl.md, which ships with the app as the project "Feedback example": sample text for tests. Read from
// the source the project file is written from (tools/examples), so there is one copy of it.
import { readFileSync } from "node:fs";

export const EXAMPLE_PROJECT_NAME = "Feedback example";
export const EXAMPLE_SOURCE = readFileSync(new URL(`../../../../tools/examples/${EXAMPLE_PROJECT_NAME}.face`, import.meta.url), "utf8");
