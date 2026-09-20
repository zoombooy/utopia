import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";

import { api, ApiError } from "../api";
import { S } from "../i18n";
import {
  Button,
  Input,
  Segmented,
  Wordmark,
} from "../ui";
import { LoginScene } from "./LoginScene";
import { usePageTitle } from "../useTitle";

export function Login() {
  usePageTitle(S.app.name, S.login.signIn);
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [leaving, setLeaving] = useState(false);
  const queryClient = useQueryClient();
  const sso = useQuery({ queryKey: ["oidc-status"], queryFn: api.oidcStatus });
  // 单点登录回调失败时带着代码跳回这里（`?sso_error=`），措辞按代码查
  const ssoError = new URLSearchParams(window.location.search).get("sso_error");

  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === "login") return api.login(email, password);
      return api.register(email, password, displayName);
    },
    onSuccess: () => {
      // 换人先清缓存：`me`、`workspaces` 这些一次会话内不过期（queryDefaults.ts），
      // 会话过期后同一标签页登另一个账号，不清就看见上一个人的名字和库
      queryClient.clear();
      // 谢幕：卡片上浮淡出、巨构放大穿越，再进入图谱首页
      setLeaving(true);
      window.setTimeout(() => navigate({ to: "/" }), 650);
    },
  });

  const error =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.error
        ? S.login.networkError
        : null;


  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      {/* 巨构变换背景：星球 → 环形都市 → 城市平原 → 波动巨碑 */}
      <LoginScene leaving={leaving} />
      <div
        className={`relative z-10 w-full max-w-sm ${leaving ? "u-depart" : ""}`}
      >
        <div className="mb-8 text-center u-rise">
          <h1 className="u-wordmark-hero font-normal">
            <Wordmark />
          </h1>
          <p className="mt-2 text-body text-ink-2">
            {S.app.tagline}
            <span className="ml-2 text-fine">{S.app.taglineSource}</span>
          </p>
        </div>

        <div
          className="u-card-opaque rounded-panel p-6 u-rise"
          style={{ animationDelay: "90ms" }}
        >
          <Segmented
            fill
            className="mb-6"
            value={mode}
            onChange={setMode}
            options={(["login", "register"] as const).map((m) => ({
              value: m,
              label: m === "login" ? S.login.signIn : S.login.signUp,
            }))}
          />

          {ssoError && (
            <p role="alert" className="mb-3 text-small text-danger">
              {S.login.ssoErrors[ssoError] ?? S.login.ssoErrorOther}
            </p>
          )}

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            {mode === "register" && (
              <Input
                className="w-full"
                placeholder={S.login.displayName}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            )}
            <Input
              type="email"
              className="w-full"
              placeholder={S.login.email}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              type="password"
              className="w-full"
              placeholder={S.login.password}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
            {error && <p className="text-body text-danger">{error}</p>}
            <Button variant="primary" size="md" className="w-full"
              type="submit"
              disabled={mutation.isPending || leaving}
            >
              {mutation.isPending || leaving
                ? S.login.submitting
                : mode === "login"
                  ? S.login.signIn
                  : S.login.createAccount}
            </Button>
          </form>

          {mode === "login" && sso.data?.enabled && (
            <>
              <div className="my-4 flex items-center gap-3 text-fine text-ink-2">
                <span className="h-px flex-1 bg-line" />
                {S.login.orDivider}
                <span className="h-px flex-1 bg-line" />
              </div>
              <Button variant="secondary" size="md" className="w-full"
                disabled={leaving}
                onClick={() => {
                  window.location.href = "/api/v1/auth/oidc/start";
                }}
              >
                {S.login.ssoButton}
              </Button>
            </>
          )}
        </div>

        {/* 页脚：站内条款与隐私说明 */}
        <div
          className="mt-6 text-center u-rise"
          style={{ animationDelay: "180ms" }}
        >
          <p className="u-balance text-fine leading-relaxed text-ink-2">
            {S.login.agreePrefix}
            <Link
              to="/terms"
              className="u-link whitespace-nowrap"
            >
              {S.legal.termsTitle}
            </Link>
            {S.login.agreeAnd}
            <Link
              to="/privacy"
              className="u-link whitespace-nowrap"
            >
              {S.legal.privacyTitle}
            </Link>
            {S.login.agreeSuffix}
          </p>
        </div>
      </div>
    </div>
  );
}
