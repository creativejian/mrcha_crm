export const roleTabs = ["최고관리자", "팀장", "상담사", "딜러"] as const;

export type RoleTab = (typeof roleTabs)[number];

export const roleAccountMeta: Record<RoleTab, { name: string; title: string }> = {
  최고관리자: { name: "지안", title: "최고관리자" },
  팀장: { name: "선생님", title: "팀장" },
  상담사: { name: "제프", title: "상담사" },
  딜러: { name: "권지현", title: "BMW 한독/서초" },
};
