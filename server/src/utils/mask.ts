export function maskPhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) return `${digits.slice(0, 3)}****${digits.slice(7)}`;
  if (digits.length >= 7) return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
  return "***";
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}
