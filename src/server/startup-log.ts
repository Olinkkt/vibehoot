export function formatBindHost(host: string): string {
  if (host.includes(":") && !host.startsWith("[")) {
    return `[${host}]`;
  }
  return host;
}

export function isWildcardBind(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "[::]";
}

export function startupMessages(options: {
  bindHost: string | undefined;
  port: number;
  dev: boolean;
  lan: readonly string[];
}): string[] {
  const mode = options.dev ? "development" : "production";
  const bound = options.bindHost !== undefined && options.bindHost.length > 0;
  const announceLan = !bound || isWildcardBind(options.bindHost ?? "");
  const shownHost = announceLan ? "localhost" : formatBindHost(options.bindHost ?? "localhost");
  const lines = [
    `> Slophoot ready on http://${shownHost}:${options.port.toString()} (${mode}, socket.io attached)`,
  ];

  if (!announceLan || options.lan.length === 0) {
    return lines;
  }

  lines.push("> Players on this network can open:");
  for (const address of options.lan) {
    lines.push(`>   http://${address}:${options.port.toString()}`);
  }
  return lines;
}
