export const dynamic = "force-dynamic";

export function GET(): Response {
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
