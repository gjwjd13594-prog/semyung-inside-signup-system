import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

async function main() {
  const adminUsername = process.env.ADMIN_USERNAME || "admin";
  const adminEmail = process.env.ADMIN_EMAIL || "admin@example.local";
  const adminNickname = process.env.ADMIN_NICKNAME || "관리자";
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    throw new Error("ADMIN_PASSWORD 환경변수를 설정한 뒤 seed를 실행해 주세요. 공개 저장소에는 관리자 비밀번호를 하드코딩하지 않습니다.");
  }

  const category = await prisma.category.upsert({
    where: { id: 1 },
    update: { name: "종합", sortOrder: 1 },
    create: { id: 1, name: "종합", sortOrder: 1 },
  });

  const boards = [
    { slug: "notice", name: "공지사항", description: "관리자와 매니저가 올리는 공식 공지", isHot: true },
    { slug: "free", name: "자유게시판", description: "자유롭게 이야기하는 게시판", isHot: true },
    { slug: "humor", name: "유머", description: "재미있는 글과 이미지", isHot: true },
    { slug: "news", name: "뉴스", description: "학교와 사회 뉴스 토론", isHot: false },
  ];

  for (const [index, board] of boards.entries()) {
    await prisma.board.upsert({
      where: { slug: board.slug },
      update: {
        name: board.name,
        description: board.description,
        isHot: board.isHot,
        sortOrder: index + 1,
        categoryId: category.id,
      },
      create: { ...board, sortOrder: index + 1, categoryId: category.id },
    });
  }

  const password = await bcrypt.hash(adminPassword, 12);
  const admin = await prisma.user.upsert({
    where: { username: adminUsername },
    update: {
      email: adminEmail,
      nickname: adminNickname,
      password,
      role: "ADMIN",
      isVerified: true,
      isBanned: false,
      banReason: null,
      banUntil: null,
    },
    create: {
      username: adminUsername,
      email: adminEmail,
      nickname: adminNickname,
      password,
      role: "ADMIN",
      isVerified: true,
    },
    select: { id: true, username: true, email: true, nickname: true, role: true },
  });

  console.log(`Admin seed completed: ${admin.username} (${admin.role})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
