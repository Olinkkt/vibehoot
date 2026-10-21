import { connection } from "next/server";

// `cacheComponents` rejects `dynamic = "force-dynamic"`. `connection()` is the
// per-request opt-out, so uptime is not frozen during prerender.
export async function GET(): Promise<Response> {
  await connection();

  return Response.json(
    { ok: true, uptime: Math.floor(process.uptime()) },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
