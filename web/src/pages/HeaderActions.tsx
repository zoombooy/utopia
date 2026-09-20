/* 顶栏右侧那一组：站内入口、告警铃与用户菜单。三个顶栏共用这一份，
   避免换页时右上角的间距和对齐发生变化。 */
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { User } from "../api";
import { AlertBell } from "./AlertBell";
import { UserMenu } from "./UserMenu";

export function HeaderActions({
  link,
  user,
  signedOut,
}: {
  /** 最左那个链接：去哪、写什么 */
  link: { to: "/" | "/docs"; label: string };
  user: User | null | undefined;
  /** 没登录时放在铃铛与用户菜单位置上的东西（Docs 页的「登录」）；缺省什么都不放 */
  signedOut?: ReactNode;
}) {
  return (
    <div className="ml-auto flex items-center gap-3">
      <Link to={link.to} className="u-navlink">
        {link.label}
      </Link>
      {user ? (
        <>
          {/* 告警角标跟着人走，不跟着页面走：读文档、改账户的时候库照样在跑 */}
          <AlertBell />
          <UserMenu user={user} />
        </>
      ) : (
        signedOut
      )}
    </div>
  );
}
