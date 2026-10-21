import Image from "next/image";
import type { ButtonHTMLAttributes, ReactNode } from "react";

const SHAPE_KEYS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"] as const;

function classNames(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Stage({
  variant,
  children,
}: {
  variant: "join" | "lobby";
  children: ReactNode;
}) {
  return (
    <div className="sh-stage">
      <div className="sh-bg" aria-hidden="true">
        <div className={classNames("sh-artboard", `sh-artboard-${variant}`)}>
          {SHAPE_KEYS.map((key) => (
            <span key={key} className={key} />
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}

export function Logo({
  className,
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/logo-full.svg"
      alt="Slophoot"
      width={733}
      height={200}
      priority={priority}
      unoptimized
      className={classNames("sh-logo", className)}
    />
  );
}

export function GoldButton({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={classNames("sh-gold", className)} {...props} />;
}
