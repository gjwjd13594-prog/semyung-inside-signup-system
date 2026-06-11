export const CARRIERS = new Set(["SKT", "KT", "LGU", "SKT_MVNO", "KT_MVNO", "LGU_MVNO"]);

export function normalizePhone(input: string) {
  const digits = input.replace(/\D/g, "");

  if (digits.startsWith("8210") && digits.length === 12) {
    return `0${digits.slice(2)}`;
  }

  if (digits.startsWith("10") && digits.length === 10) {
    return `0${digits}`;
  }

  return digits;
}

export function isValidKoreanMobile(phone: string) {
  return /^010\d{8}$/.test(phone);
}
