import { getPublicApiVersions } from "../api/auth.js";

export async function handleCheckAuth(): Promise<{
  content: Array<{ type: string; text: string }>;
}> {
  const versions = await getPublicApiVersions();
  const supported = versions.filter((v) => v.supported);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            authenticated: true,
            supported_versions: supported.map((v) => v.handle),
            all_versions: versions,
          },
          null,
          2
        ),
      },
    ],
  };
}
