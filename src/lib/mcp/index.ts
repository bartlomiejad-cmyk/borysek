import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listProjects from "./tools/list-projects";
import getProject from "./tools/get-project";
import listProducts from "./tools/list-products";
import getProduct from "./tools/get-product";
import startDiscovery from "./tools/start-discovery";
import getJobStatus from "./tools/get-job-status";
import runAudit from "./tools/run-audit";
import exportProject from "./tools/export-project";

// Direct Supabase issuer — never the .lovable.cloud proxy (RFC 8414 mismatch).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "borysek-pim",
  title: "Borysek PIM",
  version: "0.1.0",
  instructions:
    "Narzędzia do zarządzania projektami PIM: lista projektów, produkty, uruchamianie discovery i audytu AI, eksport golden data. Każde wywołanie działa w kontekście zalogowanego użytkownika (RLS).",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listProjects,
    getProject,
    listProducts,
    getProduct,
    startDiscovery,
    getJobStatus,
    runAudit,
    exportProject,
  ],
});