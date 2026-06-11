import crypto from "crypto";
import { config } from "../config.js";
import { normalizePhone } from "./phone.js";

type SolapiErrorBody = {
  errorCode?: string;
  errorMessage?: string;
  message?: string;
};

export async function sendPhoneVerificationSms(phone: string, code: string) {
  return sendSolapiText(phone, `[세명 인사이드]\n휴대폰 인증번호는 ${code} 입니다.\n5분 안에 입력해 주세요.`);
}

async function sendSolapiText(to: string, text: string) {
  const apiKey = config.solapi.apiKey;
  const apiSecret = config.solapi.apiSecret;
  const from = normalizePhone(config.solapi.senderPhone);

  if (!apiKey || !apiSecret || !from) {
    throw new Error("SOLAPI 환경변수가 설정되지 않았습니다.");
  }

  const response = await fetch("https://api.solapi.com/messages/v4/send", {
    method: "POST",
    headers: {
      Authorization: authorization(apiKey, apiSecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        to: normalizePhone(to),
        from,
        text,
      },
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as SolapiErrorBody | null;
    const detail = body?.errorMessage || body?.message || body?.errorCode || response.statusText;
    throw new Error(`SOLAPI 오류: HTTP ${response.status} / ${detail}`);
  }

  return response.json().catch(() => ({}));
}

function authorization(apiKey: string, apiSecret: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const date = new Date().toISOString();
  const signature = crypto.createHmac("sha256", apiSecret).update(`${date}${salt}`).digest("hex");

  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}
