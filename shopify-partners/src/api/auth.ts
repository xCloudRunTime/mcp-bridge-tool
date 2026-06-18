import { gql } from "./client.js";
import { PUBLIC_API_VERSIONS } from "./queries.js";
import type { ApiVersion } from "./types.js";

interface PublicApiVersionsData {
  publicApiVersions: ApiVersion[];
}

export async function getPublicApiVersions(): Promise<ApiVersion[]> {
  const data = await gql<PublicApiVersionsData>(PUBLIC_API_VERSIONS);
  return data.publicApiVersions;
}
