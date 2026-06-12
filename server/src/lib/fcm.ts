import { prisma } from "../prisma.js";

let adminApp: typeof import("firebase-admin") | null = null;

async function getAdmin() {
  if (adminApp) return adminApp;
  const saPath = process.env.FIREBASE_SA_PATH;
  if (!saPath) return null;
  try {
    const { default: admin } = await import("firebase-admin");
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(saPath) });
    }
    adminApp = admin;
    return admin;
  } catch {
    return null;
  }
}

export async function pushToUser(
  userId: number,
  body: string,
  data?: Record<string, string>,
) {
  const admin = await getAdmin();
  if (!admin) return;

  const tokens = await prisma.deviceToken.findMany({ where: { userId } });
  if (!tokens.length) return;

  const res = await admin.messaging().sendEachForMulticast({
    tokens: tokens.map((t) => t.token),
    notification: { body },
    data: data ?? {},
  });

  const invalid: string[] = [];
  res.responses.forEach((r, i) => {
    if (
      !r.success &&
      [
        "messaging/registration-token-not-registered",
        "messaging/invalid-registration-token",
      ].includes(r.error?.code ?? "")
    ) {
      invalid.push(tokens[i].token);
    }
  });
  if (invalid.length) await prisma.deviceToken.deleteMany({ where: { token: { in: invalid } } });
}
