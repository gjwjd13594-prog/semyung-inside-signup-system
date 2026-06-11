import nodemailer from "nodemailer";
import { config } from "../config.js";

function assertSmtpConfigured() {
  if (!config.smtp.host || !config.smtp.user || !config.smtp.pass) {
    throw new Error("SMTP_HOST, SMTP_USER, SMTP_PASS 환경변수가 필요합니다.");
  }
}

export function createTransporter() {
  assertSmtpConfigured();
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  });
}

export async function sendMail(options: { to: string; subject: string; html: string; text?: string }) {
  const transporter = createTransporter();
  return transporter.sendMail({
    from: config.smtp.from,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  });
}

export async function sendEmailVerification(to: string, code: string) {
  return sendMail({
    to,
    subject: "[세명 인사이드] 이메일 인증 코드",
    text: `이메일 인증 코드는 ${code} 입니다.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6">
        <h2>이메일 인증</h2>
        <p>아래 인증 코드를 회원가입 화면에 입력해 주세요.</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>
        <p>본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다.</p>
      </div>
    `,
  });
}

export async function sendPasswordReset(to: string, link: string) {
  return sendMail({
    to,
    subject: "[세명 인사이드] 비밀번호 재설정",
    text: `비밀번호 재설정 링크: ${link}`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6">
        <h2>비밀번호 재설정</h2>
        <p>아래 버튼을 눌러 비밀번호를 재설정해 주세요. 링크는 30분 동안만 유효합니다.</p>
        <p><a href="${link}" style="display:inline-block;background:#e63312;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px">비밀번호 재설정</a></p>
      </div>
    `,
  });
}
