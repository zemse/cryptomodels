import type { OtpResponse } from "../types";

const OTP_INTERVAL_MS = 10000; // 10 seconds

export function getOtpMessage(): OtpResponse {
  const epoch = Math.floor(Date.now() / OTP_INTERVAL_MS);
  return {
    message: `relay-auth-${epoch}`,
    validUntil: (epoch + 1) * OTP_INTERVAL_MS,
  };
}

export function isValidOtp(message: string): boolean {
  const epoch = Math.floor(Date.now() / OTP_INTERVAL_MS);
  const current = `relay-auth-${epoch}`;
  const previous = `relay-auth-${epoch - 1}`;
  return message === current || message === previous;
}

export function getOtpPrefix(): string {
  return "relay-auth-";
}
