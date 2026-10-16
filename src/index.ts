import system from "../prompt/system.md";
import { handle, type Env } from "./app.ts";

export default {
  fetch(request, env) {
    return handle(request, env, system);
  },
} satisfies ExportedHandler<Env>;
