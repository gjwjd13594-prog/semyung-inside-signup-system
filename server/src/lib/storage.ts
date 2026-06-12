import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { config } from "../config.js";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

function getClient() {
  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    throw Object.assign(new Error("Supabase 설정이 없습니다. SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY를 설정해주세요."), { status: 503 });
  }
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function uploadPhoto(userId: number, buffer: Buffer, contentType: string): Promise<{ key: string; url: string }> {
  if (!ALLOWED.includes(contentType)) {
    throw Object.assign(new Error("지원하지 않는 이미지 형식입니다. (jpeg/png/webp)"), { status: 400 });
  }
  const ext = contentType.split("/")[1];
  const key = `profile/${userId}/${randomUUID()}.${ext}`;
  const supabase = getClient();
  const { error } = await supabase.storage
    .from(config.supabase.storageBucket)
    .upload(key, buffer, { contentType, upsert: false });
  if (error) throw Object.assign(new Error(`사진 업로드에 실패했습니다: ${error.message}`), { status: 500 });
  const { data: urlData } = supabase.storage.from(config.supabase.storageBucket).getPublicUrl(key);
  return { key, url: urlData.publicUrl };
}

export async function deletePhoto(key: string): Promise<void> {
  const supabase = getClient();
  await supabase.storage.from(config.supabase.storageBucket).remove([key]).catch(() => {});
}
