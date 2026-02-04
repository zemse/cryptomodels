import { Hono } from "hono";
import { getOtpMessage } from "../auth/otp";

const otpRouter = new Hono();

otpRouter.get("/", (c) => {
  const otp = getOtpMessage();
  return c.json(otp);
});

export { otpRouter };
