export const NICKNAME_MAX_LENGTH = 20;
export const NICKNAME_DRAFT_CAP = 100;
export const PIN_LENGTH = 4;

export const JOIN_ERRORS = {
  unknownPin: "No room found for that PIN.",
  emptyNickname: "Enter a nickname.",
  nicknameTooLong: "Nickname must be 20 characters or fewer.",
  duplicateNickname: "That nickname is already taken.",
  invalidRequest: "Invalid join request.",
} as const;

export const HOST_ERRORS = {
  noRooms: "No rooms available, try again later.",
  tooFast: "Please wait a moment before creating another room.",
  tooMany: "Too many rooms from this network. Try again later.",
} as const;

const DISALLOWED_CHARS = /[\p{Cc}\p{Cf}]/gu;
const INTERNAL_WHITESPACE = /\s+/gu;
const PIN_PATTERN = /^\d{4}$/;

export function normalizeNickname(value: string): string {
  return value
    .normalize("NFKC")
    .replace(DISALLOWED_CHARS, "")
    .replace(INTERNAL_WHITESPACE, " ")
    .trim();
}

export function nicknameLength(value: string): number {
  return Array.from(value).length;
}

export function capNicknameDraft(value: string): string {
  return Array.from(value).slice(0, NICKNAME_DRAFT_CAP).join("");
}

export function normalizePin(value: string): string | null {
  const pin = value.trim();
  return PIN_PATTERN.test(pin) ? pin : null;
}
