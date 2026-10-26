import { httpJson } from "../http.js";
import type { Config } from "../config.js";

export async function createLinearIssue(c: Config, title: string, description: string): Promise<{ url: string; identifier: string }> {
  if (!c.linear.apiKey) throw new Error("Linear is not configured (LINEAR_API_KEY)");
  const gql = async (query: string, variables: object = {}) => {
    const r = await httpJson<any>("https://api.linear.app/graphql", {
      method: "POST",
      headers: { Authorization: c.linear.apiKey!, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      timeoutMs: c.httpTimeoutMs,
      retries: 0, // issueCreate is not idempotent
    });
    if (r.errors?.length) throw new Error(`Linear: ${r.errors[0].message}`);
    return r.data;
  };
  let teamId = c.linear.teamId;
  if (!teamId) teamId = (await gql(`{ teams(first:1){ nodes{ id } } }`)).teams.nodes[0]?.id;
  if (!teamId) throw new Error("No Linear team found; set LINEAR_TEAM_ID");
  const d = await gql(
    `mutation($i: IssueCreateInput!){ issueCreate(input:$i){ success issue{ identifier url } } }`,
    { i: { teamId, title, description } },
  );
  if (!d.issueCreate?.success) throw new Error("Linear issueCreate failed");
  return d.issueCreate.issue;
}
